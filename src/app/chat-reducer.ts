import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";

export type ChatPhase = "loading" | "idle" | "streaming" | "offline" | "error";

export interface ChatState {
  phase: ChatPhase;
  activeConversation?: Conversation;
  messages: ChatMessage[];
  locale: Locale;
  pendingImage?: StoredImage;
  errorCode?: string;
}

export type ChatAction =
  | { type: "loaded"; conversation: Conversation; messages: ChatMessage[]; locale: Locale }
  | { type: "load-failed"; errorCode: string }
  | { type: "send-started"; user?: ChatMessage; assistant: ChatMessage }
  | { type: "delta"; messageId: string; text: string }
  | { type: "completed"; messageId: string }
  | { type: "stopped"; messageId: string }
  | { type: "failed"; messageId: string; errorCode: string }
  | { type: "connectivity-changed"; online: boolean }
  | { type: "conversation-selected"; conversation: Conversation; messages: ChatMessage[] }
  | { type: "locale-changed"; locale: Locale }
  | { type: "pending-image-changed"; image?: StoredImage }
  | { type: "clear-error" };

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

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "loaded":
      return {
        activeConversation: action.conversation,
        locale: action.locale,
        messages: action.messages,
        phase: "idle",
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
      };
    case "delta":
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          text: message.text + action.text,
        })),
      };
    case "completed":
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          status: "complete",
        })),
        phase: state.phase === "offline" ? "offline" : "idle",
      };
    case "stopped":
      return {
        ...state,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          status: "stopped",
        })),
        phase: state.phase === "offline" ? "offline" : "idle",
      };
    case "failed":
      return {
        ...state,
        errorCode: action.errorCode,
        messages: updateMessage(state.messages, action.messageId, (message) => ({
          ...message,
          status: "failed",
        })),
        phase: "error",
      };
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
      return { ...state, errorCode: undefined, phase: state.phase === "error" ? "idle" : state.phase };
  }
}
