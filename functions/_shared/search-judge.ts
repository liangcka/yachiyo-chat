import { fetchWithTimeout } from "./web-search/http";
import type { ClientHistoryMessage } from "./validation";
import type { ProviderAdapter } from "./providers/registry";

/** 判断请求超时（毫秒）：快速失败，超时走规则门控兜底 */
const judgeTimeoutMs = 4_000;
/** 判断上下文：附带最近几条消息（约 2 轮对话）帮助模型理解追问语境 */
const maximumContextMessages = 4;
/** 单条消息文本截断（Unicode 字符），防止注入超长上下文 */
const maximumMessageCharacters = 500;

/** 判断 prompt：标准明确、输出约束强；确保不确定专有名词与梗概念准确判定为 YES */
const judgeSystemPrompt = [
  "你是一个搜索意图判断器。根据对话上下文与用户最新消息，判断回答是否必须联网搜索外部最新信息。",
  "输出规则：只输出 YES 或 NO，不要任何其他内容。",
  "YES：需要获取外部互联网具体事实、新闻事件、时事动态、天气预报、体育赛况比分、股票汇率；产品或模型最新发布进展/版本特性；网络流行语、游戏黑话、热梗、概念定义、作品或实体含义（如“XX是什么”、“XX是什么梗”、“什么是XX”）；对未知概念、不确定的专有名词求证；任何需要外部事实知识支撑的提问。",
  "NO：当前时间或日期查询（如“现在几点”、“今天星期几”，系统已有时间感知，绝不要搜索）；与角色（月见八千代）的日常闲聊、问候告别、情感交流、生活吐槽（如“陪我聊聊烦恼”）；对角色的日常提问（如“你喜欢什么”、“在干嘛”）；创作、文案、角色扮演互动；翻译、改写、代码问题；纯数学计算、逻辑推理；对图片的评论与日常问答。",
  "如果消息属于概念、专有名词、实体或黑话提问但模型知识库不确定其确切含义时，必须输出 YES 借助搜索求证。",
].join("\n");

/**
 * 选择判断上下文：从最新消息往前取最多 4 条，
 * 跳过纯图片（无文本）、客户端注入消息（"【"开头，非真实提问），剥掉图片只留文本。
 * 合并连续同角色消息并丢弃开头的 assistant 消息（Anthropic 非流式接口要求首条为 user）。
 * 返回 null 表示最新 user 消息无有效文本（纯图片等），无需发判断请求。
 */
export function buildJudgeMessages(
  messages: readonly ClientHistoryMessage[],
): ReadonlyArray<{ role: "user" | "assistant"; text: string }> | null {
  const raw: Array<{ role: "user" | "assistant"; text: string }> = [];

  for (let index = messages.length - 1; index >= 0 && raw.length < maximumContextMessages; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    const text = message.text.trim();
    if (text.length === 0 || text.startsWith("【")) {
      // 最新 user 消息为空文本（纯图片）时整体不判断
      if (raw.length === 0 && message.role === "user") {
        return null;
      }
      continue;
    }
    raw.unshift({
      role: message.role === "assistant" ? "assistant" : "user",
      text: [...text].slice(0, maximumMessageCharacters).join(""),
    });
  }

  // 合并连续同角色消息（保持时序，紧凑上下文）
  const selected: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const message of raw) {
    const previous = selected[selected.length - 1];
    if (previous?.role === message.role) {
      previous.text = previous.text.length === 0 ? message.text : `${previous.text}\n${message.text}`;
    } else {
      selected.push({ ...message });
    }
  }
  while (selected.length > 0 && selected[0].role === "assistant") {
    selected.shift();
  }

  return selected.length > 0 ? selected : null;
}

/**
 * 解析判断输出：容忍大小写与尾缀杂质（"YES。"、"No!"），
 * 前缀匹配 YES/NO；无法解析返回 null（调用方回退规则门控）。
 */
export function parseJudgeVerdict(text: string): boolean | null {
  const normalized = text.trim().toUpperCase();
  if (/^YES\b/u.test(normalized)) {
    return true;
  }
  if (/^NO\b/u.test(normalized)) {
    return false;
  }
  return null;
}

/**
 * 模型自主判断是否需要联网搜索：
 * 向指定 provider 发非流式判断请求（内部 4 秒超时，联动客户端断开信号）。
 * 任何失败（网络错误、超时、非 200、解析失败、无法识别的输出）返回 null，
 * 由调用方回退到规则门控 shouldSearchWeb，行为不劣于现状。
 */
export async function judgeSearchNeed(
  provider: ProviderAdapter,
  apiKey: string,
  model: string,
  messages: readonly ClientHistoryMessage[],
  signal: AbortSignal | undefined,
): Promise<boolean | null> {
  const judgeMessages = buildJudgeMessages(messages);
  if (judgeMessages === null) {
    return null;
  }

  const built = provider.buildJudgeRequest({
    apiKey,
    model,
    systemPrompt: judgeSystemPrompt,
    messages: judgeMessages,
  });

  try {
    const response = await fetchWithTimeout(
      built.url,
      {
        method: "POST",
        headers: built.headers,
        body: built.body,
      },
      judgeTimeoutMs,
      signal,
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = provider.extractJudgeText(await response.text());
    return text === null ? null : parseJudgeVerdict(text);
  } catch {
    return null;
  }
}
