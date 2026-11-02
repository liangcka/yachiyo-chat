import type { ChatMessage, Locale, StoredImage } from "../../domain/chat";
import type { StreamChatMessage } from "../../services/chat-client";
import type { SkillDefinition } from "../../skills";

/** 单次请求的历史体积上限，与服务端校验及摘要分批共用同一组约束。 */
export const requestLimits = Object.freeze({
  messages: 20,
  messageCharacters: 4_000,
  totalCharacters: 24_000,
});

/** 未压缩历史消息达到该数量时，发送前自动触发增量压缩（为摘要/长期记忆前缀预留槽位） */
export const compressionTriggerUncompressedMessages = requestLimits.messages - 4;

/** 长期记忆与会话摘要注入请求前的字符上限 */
const contextBlockCharacters = 3_000;

const weekdaysZh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;
const weekdaysJa = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"] as const;

export function formatClientTimestamp(timestamp: number, locale: Locale): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  const weekday = locale === "ja-JP" ? weekdaysJa[date.getDay()] : weekdaysZh[date.getDay()];
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${weekday}`;
}

export function truncateUnicode(value: string, maximum: number): string {
  let result = "";
  let length = 0;
  for (const character of value) {
    if (length >= maximum) break;
    result += character;
    length += 1;
  }
  return result;
}

function characterCount(value: string): number {
  return [...value].length;
}

export function isHistoryMessage(message: ChatMessage): boolean {
  return message.status === "complete" || message.status === "stopped";
}

/** 早于压缩边界的消息已被摘要取代，不再重复进入请求（retained-tail 语义） */
function isUncompressedHistory(message: ChatMessage, compressedUpTo?: number): boolean {
  return isHistoryMessage(message) && (compressedUpTo === undefined || message.createdAt > compressedUpTo);
}

/** 仅统计压缩边界之后（未被摘要取代）的 eligible 消息数 */
export function countUncompressedMessages(
  messages: readonly ChatMessage[],
  compressedUpTo?: number,
): number {
  return messages.filter((message) => isUncompressedHistory(message, compressedUpTo)).length;
}

function selectRequestHistory(
  messages: readonly ChatMessage[],
  reserveCharacters: number,
  maxMessages: number,
  compressedUpTo?: number,
): Array<{ message: ChatMessage; text: string }> {
  const eligible = messages.filter((message) => isUncompressedHistory(message, compressedUpTo));
  const selected: Array<{ message: ChatMessage; text: string }> = [];
  let totalCharacters = reserveCharacters;

  for (let index = eligible.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const message = eligible[index];
    if (message === undefined) continue;
    const text = truncateUnicode(message.text, requestLimits.messageCharacters);
    const isLastMessage = index === eligible.length - 1;
    if (!isLastMessage && text.trim().length === 0) continue;
    const length = characterCount(text);
    if (totalCharacters + length > requestLimits.totalCharacters) break;
    selected.unshift({ message, text });
    totalCharacters += length;
  }

  return selected;
}

interface ContextPrefix {
  messages: StreamChatMessage[];
  characters: number;
}

/**
 * 技能、长期记忆与会话摘要以“用户陈述 + 角色确认”成对前置，
 * 每一对都占用历史消息槽位与字符预算，确保整体请求不超服务端上限。
 */
function buildContextPrefix(
  locale: Locale,
  skills: readonly SkillDefinition[],
  userMemory: string,
  summary: string,
): ContextPrefix {
  const japanese = locale === "ja-JP";
  const pairs: Array<[user: string, assistant: string]> = [];

  if (skills.length > 0) {
    pairs.push([
      `【技能指令 / Skill Instructions】\n以下技能已激活，回复时必须严格遵守：\n\n${skills
        .map((skill) => skill.content)
        .join("\n\n---\n\n")}`,
      japanese ? "（技能指示を確認しました。厳守して実行します）" : "（已收到技能指令，将严格遵守执行）",
    ]);
  }

  const memory = truncateUnicode(userMemory, contextBlockCharacters).trim();
  if (memory.length > 0) {
    pairs.push(japanese
      ? [
          `【彩葉についての長期記憶（全ての会話で共有される事実）】\n${memory}\nこれは実際に起きた確定した事実として扱ってください。`,
          "（彩葉のこと、ちゃんと覚えていますよ）",
        ]
      : [
          `【关于彩叶的长期记忆（所有对话共享的事实）】\n${memory}\n以下内容请作为真实发生的既定事实对待。`,
          "（关于彩叶的事情，我一直都记得哦~）",
        ]);
  }

  const activeSummary = truncateUnicode(summary, contextBlockCharacters).trim();
  if (activeSummary.length > 0) {
    pairs.push(japanese
      ? [
          `【これまでの会話の記憶・背景（実際に起きた確定した事実）】\n${activeSummary}\nこれは私たちが実際に経験した会話の記録です。既定の事実として守り、引き継いでください。`,
          "（これまでの経緯と記憶を把握しました。会話を続けます）",
        ]
      : [
          `【前情提要 / 历史背景记忆（真实发生的既定事实）】\n${activeSummary}\n这是我们真实经历过的对话记录，请作为既定事实遵守并延续。`,
          "（已记住我们之前的对话与经历，继续交流~）",
        ]);
  }

  return {
    messages: pairs.flatMap(([user, assistant]) => [
      { role: "user" as const, text: user },
      { role: "assistant" as const, text: assistant },
    ]),
    characters: pairs.reduce(
      (total, [user, assistant]) => total + characterCount(user) + characterCount(assistant),
      0,
    ),
  };
}

function blobToDataUrl(image: StoredImage): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new TypeError("Image could not be encoded."));
    });
    reader.addEventListener("error", () => reject(new TypeError("Image could not be encoded.")));
    reader.readAsDataURL(image.blob);
  });
}

export interface RequestMessagesInput {
  messages: readonly ChatMessage[];
  locale: Locale;
  skills: readonly SkillDefinition[];
  userMemory?: string;
  summary?: string;
  compressedUpTo?: number;
  /** 尚未落库的待发送图片，命中时免去一次存储读取 */
  pendingImage?: StoredImage;
  getImage: (id: string) => Promise<StoredImage | undefined>;
}

/** 组装发往模型的完整消息序列：上下文前缀 + 预算内的最近历史（仅最后一条用户消息附带图片）。 */
export async function buildRequestMessages(input: RequestMessagesInput): Promise<StreamChatMessage[]> {
  const prefix = buildContextPrefix(input.locale, input.skills, input.userMemory ?? "", input.summary ?? "");
  const history = selectRequestHistory(
    input.messages,
    prefix.characters,
    requestLimits.messages - prefix.messages.length,
    input.compressedUpTo,
  );
  const lastIndex = history.length - 1;

  const chatMessages = await Promise.all(
    history.map(async ({ message, text }, index) => {
      const requestMessage: StreamChatMessage = { role: message.role, text };
      if (index === lastIndex && message.role === "user" && message.imageId !== undefined) {
        const image = input.pendingImage?.id === message.imageId
          ? input.pendingImage
          : await input.getImage(message.imageId);
        if (image !== undefined) requestMessage.imageDataUrl = await blobToDataUrl(image);
      }
      return requestMessage;
    }),
  );

  return [...prefix.messages, ...chatMessages];
}

export interface RequestTiming {
  currentTime: string;
  previousTime?: string;
  lastMessageIntervalMs?: number;
}

/** 客户端本地时间与最近两条消息的间隔，供角色感知作息与久别重逢。 */
export function buildRequestTiming(
  history: readonly ChatMessage[],
  now: number,
  locale: Locale,
): RequestTiming {
  const eligible = history.filter(isHistoryMessage);
  const current = eligible.at(-1);
  const previous = eligible.at(-2);
  return {
    currentTime: formatClientTimestamp(now, locale),
    ...(previous !== undefined ? { previousTime: formatClientTimestamp(previous.createdAt, locale) } : {}),
    ...(current !== undefined && previous !== undefined
      ? { lastMessageIntervalMs: Math.max(0, current.createdAt - previous.createdAt) }
      : {}),
  };
}
