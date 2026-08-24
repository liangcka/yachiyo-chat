import type { ClientHistoryMessage } from "./validation";
import type { ProviderAdapter } from "./providers/registry";

/** 判断请求超时（毫秒）：快速失败，超时走规则门控兜底 */
const judgeTimeoutMs = 4_000;
/** 判断上下文：附带最近几条消息（约 2 轮对话）帮助模型理解追问语境 */
const maximumContextMessages = 4;
/** 单条消息文本截断（Unicode 字符），防止注入超长上下文 */
const maximumMessageCharacters = 500;

/** 判断 prompt：固定中文，标准明确、输出约束强；模糊判 NO（宁缺勿滥） */
const judgeSystemPrompt = [
  "你是一个搜索意图判断器。根据对话上下文与用户最新消息，判断回答是否需要联网搜索最新信息。",
  "输出规则：只输出 YES 或 NO，不要任何其他内容。",
  "YES：时效性信息（新闻、近期事件、版本发布、价格、天气、体育比分、汇率）；",
  "你知识截止日期之后出现的新事物（新产品、新作品、新政策）；用户明确要求查询或核实外部资料；",
  "随时间变化的具体事实数据。",
  "NO：日常闲聊、情感交流、问候感谢；创作类请求（写故事、文案、诗歌、角色扮演互动）；",
  "翻译、改写、代码问题；常识、数学、逻辑推理；仅针对对话已有内容的追问或澄清；对图片内容的评论。",
  "模糊时输出 NO。",
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), judgeTimeoutMs);
  const forwardAbort = () => controller.abort();

  if (signal !== undefined && signal.aborted) {
    controller.abort();
  }
  signal?.addEventListener("abort", forwardAbort);

  try {
    const response = await fetch(built.url, {
      method: "POST",
      headers: built.headers,
      body: built.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = provider.extractJudgeText(await response.text());
    return text === null ? null : parseJudgeVerdict(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
