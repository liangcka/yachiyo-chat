import type { ChatMessage, Locale } from "../domain/chat";
import type { StreamChatMessage } from "../services/chat-client";

export const maximumConversationSummaryCharacters = 2_000;

interface SummaryRequestLimits {
  messages: number;
  messageCharacters: number;
  totalCharacters: number;
}

export interface ConversationSummaryBatch {
  messages: StreamChatMessage[];
  included: ChatMessage[];
}

const compressionInstruction: Record<Locale, string> = {
  "zh-CN": `整理以上对话，只输出一个完整的 <conversation_memory>...</conversation_memory> 区块。
将已有摘要与本批对话合并为不超过 2000 字的完整摘要，保留关键事实、约定、关系与剧情进展；去重并采用用户最新的明确更正。
只整理对话中有依据的内容，不推断不存在的经历，不输出用户画像或区块外的说明。`,
  "ja-JP": `以上の会話を整理し、完全な <conversation_memory>...</conversation_memory> ブロックだけを出力してください。
既存の要約と今回の会話を統合し、2000文字以内で重要な事実、約束、関係性、物語の進展を残してください。重複を省き、ユーザーの最新の明確な訂正を優先してください。
会話に根拠のある内容だけを整理し、存在しない経験を推測したり、プロフィールやブロック外の説明を出力したりしないでください。`,
};

/** 纯文本兼容旧摘要；包含标签的输出必须完整匹配唯一的会话摘要区块。 */
export function parseConversationSummary(text: string, truncated: boolean): string | undefined {
  if (truncated) return undefined;
  const normalized = text.trim();
  const match = /^<conversation_memory>([\s\S]*?)<\/conversation_memory>$/iu.exec(normalized);
  const summary = (match?.[1] ?? normalized).trim();
  if (
    summary.length === 0 ||
    /[<>]/u.test(summary) ||
    summary.startsWith("```") ||
    [...summary].length > maximumConversationSummaryCharacters
  ) {
    return undefined;
  }
  return summary;
}

/** 最新完整一轮及其后的消息保留原文，压缩始终从尚未覆盖的最早消息开始。 */
export function selectConversationSummaryMessages(
  messages: readonly ChatMessage[],
  compressedUpTo?: number,
): ChatMessage[] {
  const eligible = messages
    .filter((message) =>
      (message.status === "complete" || message.status === "stopped") &&
      (message.text.trim().length > 0 || message.imageId !== undefined) &&
      (compressedUpTo === undefined || message.createdAt > compressedUpTo),
    )
    .sort((left, right) => left.createdAt - right.createdAt);
  let hasAssistant = false;
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index];
    if (message?.role === "assistant") hasAssistant = true;
    if (message?.role === "user" && hasAssistant) {
      // 压缩水位线按时间戳排除原文，同一时间戳必须整体留在保留区。
      const prefix = eligible.slice(0, index).filter((candidate) => candidate.createdAt < message.createdAt);
      return prefix.some((candidate) => candidate.role === "user") ? prefix : [];
    }
  }
  return [];
}

/** 超长单条拆成完整片段；一批放不下整条时留给下一批，绝不推进到部分内容。 */
export function buildConversationSummaryBatch(
  pending: readonly ChatMessage[],
  locale: Locale,
  existingSummary: string | undefined,
  limits: SummaryRequestLimits,
): ConversationSummaryBatch | undefined {
  const prompt = compressionInstruction[locale];
  const messages: StreamChatMessage[] = [];
  const summary = existingSummary?.trim();
  if (summary) {
    messages.push(
      {
        role: "user",
        text: locale === "ja-JP" ? `【既存の記憶要約】\n${summary}` : `【已有记忆摘要】\n${summary}`,
      },
      { role: "assistant", text: locale === "ja-JP" ? "既存の要約を確認しました。" : "已知悉既有摘要。" },
    );
  }
  if ([...messages, { text: prompt }].some((message) => [...message.text].length > limits.messageCharacters)) {
    return undefined;
  }
  let totalCharacters = [...prompt].length + messages.reduce((total, message) => total + [...message.text].length, 0);
  const included: ChatMessage[] = [];
  for (const message of pending) {
    const characters = [...(message.text.trim().length > 0
      ? message.text
      : locale === "ja-JP" ? "（ユーザーが画像を送信。内容のテキスト説明なし。）" : "（用户发送了一张图片，未附文字说明。）")];
    const chunks: StreamChatMessage[] = [];
    for (let offset = 0; offset < characters.length; offset += limits.messageCharacters) {
      chunks.push({ role: message.role, text: characters.slice(offset, offset + limits.messageCharacters).join("") });
    }
    if (
      totalCharacters + characters.length > limits.totalCharacters ||
      messages.length + chunks.length + 1 > limits.messages
    ) break;
    messages.push(...chunks);
    included.push(message);
    totalCharacters += characters.length;
  }
  if (included.length === 0) return undefined;
  messages.push({ role: "user", text: prompt });
  return { messages, included };
}
