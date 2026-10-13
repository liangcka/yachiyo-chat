import type { Conversation } from "./chat";

export interface ConversationMetadata {
  title: string | null;
  /** 当前会话的完整事实集合；其他会话与独立记忆由仓库合并。 */
  memory: string | null;
}

export function isUntitledConversation(
  conversation: Pick<Conversation, "title" | "titleSource">,
): boolean {
  return conversation.titleSource === undefined &&
    (conversation.title === "新的对话" || conversation.title === "新しい会話");
}

/** 模型输出必须完整通过验证，避免把截断结果或解释性文字写入长期存储。 */
export function validateConversationMetadata(value: unknown): ConversationMetadata | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("title") || !keys.includes("memory")) return undefined;
  if (record.title !== null && typeof record.title !== "string") return undefined;
  if (record.memory !== null && typeof record.memory !== "string") return undefined;

  const title = record.title === null ? null : record.title.trim();
  if (title !== null && (
    title.length === 0 || [...title].length > 24 || /[\r\n\u2028\u2029]/u.test(title)
  )) return undefined;
  const memory = record.memory === null
    ? null
    : record.memory.split(/\r?\n/u).map((line) => line.trim()).join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (memory !== null && [...memory].length > 2000) return undefined;
  return { title, memory };
}

export function parseConversationMetadata(text: string): ConversationMetadata | undefined {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
  try {
    const value: unknown = JSON.parse(fenced?.[1] ?? trimmed);
    return validateConversationMetadata(value);
  } catch {
    return undefined;
  }
}
