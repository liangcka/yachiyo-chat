import type { ChatMessage } from "../domain/chat";
import {
  createConversationSearchPattern,
  type ConversationSearchResult,
} from "../domain/conversation-search";
import type { YachiyoDatabase } from "./db";

function excerpt(text: string, matchIndex: number, query: string): string {
  const characters = Array.from(text);
  const matchStart = Array.from(text.slice(0, matchIndex)).length;
  const start = Math.max(0, matchStart - 40);
  const end = Math.min(characters.length, start + Math.max(180, Array.from(query).length + 80));
  return `${start > 0 ? "…" : ""}${characters.slice(start, end).join("")}${end < characters.length ? "…" : ""}`;
}

/** 搜索设备上的全部正文，不受聊天窗口分页和摘要水位限制。 */
export async function searchConversations(
  db: YachiyoDatabase,
  query: string,
): Promise<ConversationSearchResult[]> {
  const normalized = query.trim();
  const pattern = createConversationSearchPattern(normalized);
  return db.transaction("r", db.conversations, db.messages, async () => {
    const conversations = await db.conversations.orderBy("updatedAt").reverse().toArray();
    const results: ConversationSearchResult[] = [];

    for (const conversation of conversations) {
      if (!normalized) {
        results.push({ conversation });
        continue;
      }
      let latest: ChatMessage | undefined;
      let matchIndex = 0;
      await db.messages.where("conversationId").equals(conversation.id).each((message) => {
        const match = pattern.exec(message.text);
        if (match && (!latest || message.createdAt > latest.createdAt
          || (message.createdAt === latest.createdAt && message.id > latest.id))) {
          latest = message;
          matchIndex = match.index;
        }
      });

      if (latest) {
        results.push({
          conversation,
          message: {
            id: latest.id,
            role: latest.role,
            createdAt: latest.createdAt,
            text: excerpt(latest.text, matchIndex, normalized),
          },
        });
      } else if (pattern.test(conversation.title)) {
        results.push({ conversation });
      }
    }
    return results;
  });
}
