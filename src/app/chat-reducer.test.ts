import { describe, expect, it } from "vitest";
import type { ChatMessage, Conversation } from "../domain/chat";
import { chatReducer, initialChatState } from "./chat-reducer";

const conversation: Conversation = {
  id: "conversation-1",
  title: "新的对话",
  locale: "zh-CN",
  createdAt: 1,
  updatedAt: 1,
};

const user: ChatMessage = {
  id: "user-1",
  conversationId: conversation.id,
  role: "user",
  text: "今天有点累",
  status: "complete",
  createdAt: 2,
};

const assistant: ChatMessage = {
  id: "assistant-1",
  conversationId: conversation.id,
  role: "assistant",
  text: "",
  status: "streaming",
  createdAt: 3,
};

describe("chatReducer", () => {
  it("loads a conversation and streams text deterministically", () => {
    const loaded = chatReducer(initialChatState, {
      type: "loaded",
      conversation,
      locale: "zh-CN",
      messages: [],
    });
    const streaming = chatReducer(loaded, { type: "send-started", user, assistant });
    const withText = chatReducer(streaming, {
      type: "delta",
      messageId: assistant.id,
      text: "好~",
    });
    const completed = chatReducer(withText, {
      type: "completed",
      messageId: assistant.id,
    });

    expect(completed.phase).toBe("idle");
    expect(completed.messages).toEqual([user, { ...assistant, text: "好~", status: "complete" }]);
  });

  it("attaches sources to the streaming assistant message and ignores unknown ids", () => {
    const streaming = chatReducer(
      { ...initialChatState, phase: "idle", activeConversation: conversation },
      { type: "send-started", user, assistant },
    );
    const sources = [
      { title: "必应搜索结果一", url: "https://www.bing.com/" },
      { title: "必应搜索结果二", url: "https://cn.bing.com/" },
    ];
    const withSources = chatReducer(streaming, {
      type: "sources-received",
      messageId: assistant.id,
      sources,
    });
    const withText = chatReducer(withSources, {
      type: "delta",
      messageId: assistant.id,
      text: "基于搜索的回复",
    });
    const completed = chatReducer(withText, {
      type: "completed",
      messageId: assistant.id,
    });

    expect(completed.messages.at(-1)).toMatchObject({
      status: "complete",
      sources,
      text: "基于搜索的回复",
    });

    // messageId 不存在时原样忽略，不影响任何消息
    const ignored = chatReducer(completed, {
      type: "sources-received",
      messageId: "missing-message",
      sources,
    });
    expect(ignored).toBe(completed);
  });

  it("keeps partial text when generation is stopped", async () => {
    const streaming = chatReducer(
      { ...initialChatState, phase: "idle", activeConversation: conversation },
      { type: "send-started", user, assistant },
    );
    const withText = chatReducer(streaming, {
      type: "delta",
      messageId: assistant.id,
      text: "好~",
    });
    const stopped = chatReducer(withText, { type: "stopped", messageId: assistant.id });

    expect(stopped.messages.at(-1)).toMatchObject({ text: "好~", status: "stopped" });
    expect(stopped.phase).toBe("idle");
  });

  it("preserves partial text and exposes stable failure state", () => {
    const streaming = chatReducer(
      { ...initialChatState, phase: "idle", activeConversation: conversation },
      { type: "send-started", user, assistant },
    );
    const withText = chatReducer(streaming, {
      type: "delta",
      messageId: assistant.id,
      text: "彩叶~",
    });
    const failed = chatReducer(withText, {
      type: "failed",
      errorCode: "PROVIDER_ERROR",
      messageId: assistant.id,
    });

    expect(failed).toMatchObject({ phase: "error", errorCode: "PROVIDER_ERROR" });
    expect(failed.messages.at(-1)).toMatchObject({ text: "彩叶~", status: "failed" });
  });

  it("keeps history readable while offline and resets state on conversation switch", () => {
    const offline = chatReducer(
      {
        ...initialChatState,
        activeConversation: conversation,
        messages: [user],
        phase: "idle",
      },
      { type: "connectivity-changed", online: false },
    );
    expect(offline).toMatchObject({ phase: "offline", messages: [user] });

    const japanese = { ...conversation, id: "conversation-2", locale: "ja-JP" as const };
    const switched = chatReducer(offline, {
      type: "conversation-selected",
      conversation: japanese,
      messages: [],
    });
    expect(switched).toMatchObject({
      activeConversation: japanese,
      errorCode: undefined,
      locale: "ja-JP",
      messages: [],
      pendingImage: undefined,
      phase: "idle",
    });
  });

  it("keeps a transient network request failure retryable while the browser remains online", () => {
    const streaming = chatReducer(
      { ...initialChatState, phase: "idle", activeConversation: conversation },
      { type: "send-started", user, assistant },
    );
    const failed = chatReducer(streaming, {
      errorCode: "NETWORK_ERROR",
      messageId: assistant.id,
      type: "failed",
    });

    expect(failed).toMatchObject({
      errorCode: "NETWORK_ERROR",
      phase: "error",
    });
  });

  it("handles compress-started and context-compressed without destroying messages", () => {
    const idleState = {
      ...initialChatState,
      activeConversation: conversation,
      messages: [user],
      phase: "idle" as const,
    };
    const compressing = chatReducer(idleState, { type: "compress-started" });
    expect(compressing.phase).toBe("compressing");
    expect(compressing.messages).toEqual([user]);

    const compressed = chatReducer(compressing, {
      type: "context-compressed",
      summary: "用户今天有点累",
    });
    expect(compressed.phase).toBe("idle");
    expect(compressed.messages).toEqual([user]);
    expect(compressed.activeConversation?.summary).toBe("用户今天有点累");
  });

  it("handles messages-reverted to restore message history and clear error/streaming state", () => {
    const streamingState = {
      ...initialChatState,
      activeConversation: conversation,
      errorCode: "SOME_ERROR",
      messages: [user, assistant],
      phase: "streaming" as const,
    };
    const reverted = chatReducer(streamingState, {
      type: "messages-reverted",
      messages: [],
    });
    expect(reverted.phase).toBe("idle");
    expect(reverted.errorCode).toBeUndefined();
    expect(reverted.messages).toEqual([]);
  });
});
