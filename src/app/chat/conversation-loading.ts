import type { ChatMessage, Conversation } from "../../domain/chat";
import { isUntitledConversation } from "../../domain/conversation-metadata";
import type { ChatRepository } from "./contracts";

/** UI 窗口化：初始只加载最近 windowSize 条历史，向上滚动时按 loadStep 条上翻 */
export const historyWindowSize = 50;
export const historyLoadStep = 30;

export interface MessageWindow {
  messages: ChatMessage[];
  hasMoreHistory: boolean;
}

/** 多取 1 条探测是否还有更早历史（hasMoreHistory），避免额外的计数查询。 */
export async function loadMessageWindow(
  repository: Pick<ChatRepository, "listMessages">,
  conversationId: string,
): Promise<MessageWindow> {
  const stored = await repository.listMessages(conversationId, { limit: historyWindowSize + 1 });
  const hasMoreHistory = stored.length > historyWindowSize;
  return { messages: hasMoreHistory ? stored.slice(1) : stored, hasMoreHistory };
}

/**
 * 查找可复用的未命名空会话（排除 excludeId），并顺带清理多余的空会话，
 * 防止反复“新建对话”在历史中堆积空白记录。
 */
export async function claimReusableEmptyConversation(
  repository: Pick<ChatRepository, "listConversations" | "listMessages" | "deleteConversation">,
  excludeId?: string,
): Promise<Conversation | undefined> {
  const conversations = await repository.listConversations();
  let reusable: Conversation | undefined;

  for (const conversation of conversations) {
    if (conversation.id === excludeId) continue;
    const messages = await repository.listMessages(conversation.id, { limit: 1 });
    if (messages.length > 0 || !isUntitledConversation(conversation)) continue;
    if (reusable === undefined) {
      reusable = conversation;
    } else if (repository.deleteConversation !== undefined) {
      await repository.deleteConversation(conversation.id).catch(() => undefined);
    }
  }

  return reusable;
}
