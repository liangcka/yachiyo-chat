import type { ChatMessage, ChatSource, Conversation, Locale, StoredImage, TokenUsage } from "../domain/chat";

export type ChatPhase = "loading" | "idle" | "streaming" | "offline" | "error" | "compressing";

export interface ChatState {
  phase: ChatPhase;
  activeConversation?: Conversation;
  messages: ChatMessage[];
  locale: Locale;
  pendingImage?: StoredImage;
  errorCode?: string;
  /** 跨会话共享的用户长期记忆（压缩时从对话中提炼，新对话也可见） */
  userMemory?: string;
  /**
   * 流式增量暂存槽位：delta/thought-delta 只写入这里（O(1)），不重建 messages 数组；
   * 终态动作（completed/stopped/failed）再把全文折叠回对应消息并清空槽位。
   */
  streaming?: { messageId: string; text?: string; thought?: string };
  /** 当前窗口之前是否还有更早历史（UI 窗口化上翻加载入口） */
  hasMoreHistory?: boolean;
}

export type ChatAction =
  | {
      type: "loaded";
      conversation: Conversation;
      messages: ChatMessage[];
      locale: Locale;
      userMemory?: string;
      hasMoreHistory?: boolean;
    }
  | { type: "load-failed"; errorCode: string }
  | { type: "send-started"; user?: ChatMessage; assistant: ChatMessage }
  | { type: "delta"; messageId: string; text: string }
  | { type: "thought-delta"; messageId: string; text: string }
  | { type: "sources-received"; messageId: string; sources: ReadonlyArray<ChatSource> }
  | { type: "completed"; messageId: string; usage?: TokenUsage; latencyMs?: number }
  | { type: "stopped"; messageId: string; latencyMs?: number }
  | { type: "failed"; messageId: string; errorCode: string; latencyMs?: number }
  | { type: "connectivity-changed"; online: boolean }
  | {
      type: "conversation-selected";
      conversation: Conversation;
      messages: ChatMessage[];
      hasMoreHistory?: boolean;
    }
  | { type: "locale-changed"; locale: Locale }
  | { type: "pending-image-changed"; image?: StoredImage }
  | { type: "clear-error" }
  | { type: "compress-started" }
  | {
      type: "context-compressed";
      summary: string;
      compressedUpTo?: number;
      compressedUpToId?: string;
      userMemory?: string;
    }
  | { type: "user-memory-updated"; memory: string }
  | { type: "messages-reverted"; messages: ChatMessage[] }
  | { type: "load-earlier-loaded"; messages: ChatMessage[] };

export const initialChatState: ChatState = {
  locale: "zh-CN",
  messages: [],
  phase: "loading",
};

function updateMessage(
  messages: ChatMessage[],
  id: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((message) => (message.id === id ? update(message) : message));
}

/** 终态折叠：把流式槽位中累积的正文/思考一次性写回目标消息（仅当槽位属于该消息且有内容时） */
function foldStreamedContent(state: ChatState, messageId: string): { message?: ChatMessage } & Record<"streaming", undefined> {
  const streaming = state.streaming;
  if (
    streaming === undefined ||
    streaming.messageId !== messageId ||
    (streaming.text === undefined && streaming.thought === undefined)
  ) {
    return { streaming: undefined };
  }
  const target = state.messages.find((message) => message.id === messageId);
  if (target === undefined) return { streaming: undefined };
  return {
    message: {
      ...target,
      ...(streaming.text !== undefined ? { text: target.text + streaming.text } : {}),
      thought: ((target.thought ?? "") + (streaming.thought ?? "")) || undefined,
    },
    streaming: undefined,
  };
}

/** 把折叠结果作为字段覆盖并入终态消息更新 */
function streamedFields(folded: { message?: ChatMessage }): Partial<ChatMessage> {
  return folded.message !== undefined
    ? { text: folded.message.text, thought: folded.message.thought }
    : {};
}

/** 流式增量写入槽位（O(1)）；槽位缺失时惰性创建（要求目标消息存在），归属不符则忽略 */
function appendStreamDelta(
  state: ChatState,
  messageId: string,
  field: "text" | "thought",
  text: string,
): ChatState {
  const streaming = state.streaming;
  if (streaming !== undefined && streaming.messageId !== messageId) return state;
  if (
    streaming === undefined &&
    !state.messages.some((message) => message.id === messageId && message.status === "streaming")
  ) {
    return state;
  }
  const base = streaming ?? { messageId };
  const accumulated = (field === "text" ? base.text : base.thought) ?? "";
  return {
    ...state,
    streaming:
      field === "text"
        ? { ...base, text: accumulated + text }
        : { ...base, thought: accumulated + text },
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "loaded":
      return {
        activeConversation: action.conversation,
        locale: action.locale,
        messages: action.messages,
        phase: "idle",
        streaming: undefined,
        userMemory: action.userMemory,
        hasMoreHistory: action.hasMoreHistory,
      };
    case "load-failed":
      return { ...state, errorCode: action.errorCode, phase: "error" };
    case "send-started":
      return {
        ...state,
        errorCode: undefined,
        messages: [...state.messages, ...(action.user === undefined ? [] : [action.user]), action.assistant],
        pendingImage: undefined,
        phase: "streaming",
        streaming: undefined,
      };
    case "delta":
      return appendStreamDelta(state, action.messageId, "text", action.text);
    case "thought-delta":
      return appendStreamDelta(state, action.messageId, "thought", action.text);
    case "sources-received":
      if (!state.messages.some((message) => message.id === action.messageId)) return state;
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          sources: action.sources,
        })),
      };
    case "completed": {
      const folded = foldStreamedContent(state, action.messageId);
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          ...streamedFields(folded),
          status: "complete" as const,
          ...(action.usage !== undefined ? { usage: action.usage } : {}),
          ...(action.latencyMs !== undefined ? { latencyMs: action.latencyMs } : {}),
        })),
        streaming: folded.streaming,
        phase: state.phase === "offline" ? "offline" : "idle",
      };
    }
    case "stopped": {
      const folded = foldStreamedContent(state, action.messageId);
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          ...streamedFields(folded),
          status: "stopped" as const,
          interrupted: true,
          ...(action.latencyMs !== undefined ? { latencyMs: action.latencyMs } : {}),
        })),
        streaming: folded.streaming,
        phase: state.phase === "offline" ? "offline" : "idle",
      };
    }
    case "failed": {
      const folded = foldStreamedContent(state, action.messageId);
      return {
        ...state,
        errorCode: action.errorCode,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          ...streamedFields(folded),
          status: "failed" as const,
          ...(action.latencyMs !== undefined ? { latencyMs: action.latencyMs } : {}),
        })),
        streaming: folded.streaming,
        phase: "error",
      };
    }
    case "connectivity-changed":
      if (!action.online) return { ...state, phase: "offline" };
      if (state.phase !== "offline") return state;
      return state.errorCode === undefined
        ? { ...state, phase: "idle" }
        : { ...state, phase: "error" };
    case "conversation-selected":
      return {
        activeConversation: action.conversation,
        errorCode: undefined,
        locale: action.conversation.locale,
        messages: action.messages,
        pendingImage: undefined,
        phase: "idle",
        streaming: undefined,
        hasMoreHistory: action.hasMoreHistory,
      };
    case "locale-changed":
      return {
        ...state,
        activeConversation:
          state.activeConversation === undefined
            ? undefined
            : { ...state.activeConversation, locale: action.locale },
        locale: action.locale,
      };
    case "pending-image-changed":
      return { ...state, pendingImage: action.image };
    case "clear-error":
      return {
        ...state,
        errorCode: undefined,
        phase: state.phase === "error" || state.phase === "compressing" ? "idle" : state.phase,
      };
    case "compress-started":
      return { ...state, phase: "compressing", errorCode: undefined };
    case "context-compressed":
      return {
        ...state,
        activeConversation:
          state.activeConversation === undefined
            ? undefined
            : {
                ...state.activeConversation,
                summary: action.summary,
                ...(action.compressedUpTo !== undefined
                  ? { compressedUpTo: action.compressedUpTo }
                  : {}),
                ...(action.compressedUpToId !== undefined
                  ? { compressedUpToId: action.compressedUpToId }
                  : {}),
              },
        phase: "idle",
        ...(action.userMemory !== undefined ? { userMemory: action.userMemory } : {}),
      };
    case "user-memory-updated":
      return { ...state, userMemory: action.memory };
    case "messages-reverted":
      return {
        ...state,
        errorCode: undefined,
        messages: action.messages,
        phase: state.phase === "offline" ? "offline" : "idle",
        streaming: undefined,
      };
    case "load-earlier-loaded":
      // 前插更早历史；若流式槽位仍指向旧窗口消息则一并清掉（防御性，正常不会发生）
      if (action.messages.length === 0) return state;
      return {
        ...state,
        messages: [...action.messages, ...state.messages],
        streaming:
          state.streaming !== undefined &&
          !state.messages.some((message) => message.id === state.streaming?.messageId)
            ? undefined
            : state.streaming,
      };
  }
}
