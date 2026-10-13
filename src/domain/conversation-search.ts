import type { Conversation } from "./chat";

export interface ConversationSearchResult {
  conversation: Conversation;
  message?: {
    id: string;
    text: string;
    role: "user" | "assistant";
    createdAt: number;
  };
}

/** 使用同一字面匹配规则搜索与高亮，保留原文的字符位置。 */
export function createConversationSearchPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu");
}
