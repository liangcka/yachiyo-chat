import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Conversation, Locale } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import { ChatClientError, type StreamChatOptions, type StreamChatRequest } from "../services/chat-client";
import {
  useChatController,
  type ChatRepository,
  type StreamChatFunction,
} from "./use-chat-controller";

const conversation: Conversation = {
  id: "conversation-1",
  title: "新的对话",
  locale: "zh-CN",
  createdAt: 10,
  updatedAt: 10,
};

const greeting: ChatMessage = {
  id: "greeting-1",
  conversationId: conversation.id,
  role: "assistant",
  text: copyFor("zh-CN").firstGreeting,
  status: "complete",
  createdAt: 11,
};

function repositoryWith(
  overrides: Partial<ChatRepository> = {},
): ChatRepository {
  return {
    createConversation: vi.fn(async (locale: Locale, now?: number) => ({
      ...conversation,
      createdAt: now ?? conversation.createdAt,
      locale,
      updatedAt: now ?? conversation.updatedAt,
    })),
    getConversation: vi.fn(async (id: string) => (id === conversation.id ? conversation : undefined)),
    getImage: vi.fn(async () => undefined),
    getLocale: vi.fn(async () => "zh-CN" as const),
    listConversations: vi.fn(async () => [conversation]),
    listMessages: vi.fn(async () => [greeting]),
    putImage: vi.fn(async () => undefined),
    putMessage: vi.fn(async () => undefined),
    setConversationLocale: vi.fn(async () => undefined),
    setLocale: vi.fn(async () => undefined),
    ...overrides,
  };
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${index}`;
}

describe("useChatController", () => {
  it("creates and persists a localized greeting when history is empty", async () => {
    const created = { ...conversation, id: "new-conversation" };
    const repository = repositoryWith({
      createConversation: vi.fn(async () => created),
      listConversations: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
    });

    const { result } = renderHook(() =>
      useChatController({
        id: ids("first-greeting"),
        now: () => 20,
        repository,
        streamChat: vi.fn<StreamChatFunction>(),
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.activeConversation).toEqual(created);
    expect(result.current.messages).toEqual([
      expect.objectContaining({
        conversationId: created.id,
        id: "first-greeting",
        role: "assistant",
        status: "complete",
        text: copyFor("zh-CN").firstGreeting,
      }),
    ]);
    expect(repository.putMessage).toHaveBeenCalledWith(result.current.messages[0]);
  });

  it("persists the user before streaming and completes the assistant message", async () => {
    const repository = repositoryWith();
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("彩叶~");
      options.onDelta("辛苦啦！");
      return { truncated: false };
    });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        now: (() => {
          let value = 20;
          return () => value++;
        })(),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("  今天有点累  "));

    expect(result.current.messages.at(-2)).toMatchObject({
      id: "user-1",
      status: "complete",
      text: "今天有点累",
    });
    expect(result.current.messages.at(-1)).toMatchObject({
      id: "assistant-1",
      status: "complete",
      text: "彩叶~辛苦啦！",
    });
    const persisted = vi.mocked(repository.putMessage).mock.calls.map(([message]) => message);
    expect(persisted.slice(0, 2)).toEqual([
      expect.objectContaining({ id: "user-1" }),
      expect.objectContaining({ id: "assistant-1", status: "streaming", text: "" }),
    ]);
    expect(persisted.at(-1)).toMatchObject({
      id: "assistant-1",
      status: "complete",
      text: "彩叶~辛苦啦！",
    });
    expect(stream).toHaveBeenCalledWith(
      {
        locale: "zh-CN",
        messages: [
          { role: "assistant", text: greeting.text },
          { role: "user", text: "今天有点累" },
        ],
      },
      expect.objectContaining({ onDelta: expect.any(Function), signal: expect.any(AbortSignal) }),
    );
  });

  it("aborts generation and preserves partial text when stopped", async () => {
    const repository = repositoryWith();
    let capturedSignal: AbortSignal | undefined;
    const stream = vi.fn<StreamChatFunction>(
      async (_request: StreamChatRequest, options: StreamChatOptions) => {
        capturedSignal = options.signal;
        options.onDelta("先休息");
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("累了");
    });
    await waitFor(() => expect(result.current.messages.at(-1)?.text).toBe("先休息"));
    await act(async () => {
      result.current.stop();
      await sendPromise;
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.messages.at(-1)).toMatchObject({
      status: "stopped",
      text: "先休息",
    });
    expect(vi.mocked(repository.putMessage).mock.calls.at(-1)?.[0]).toMatchObject({
      status: "stopped",
      text: "先休息",
    });
  });

  it("retries a failed response without duplicating its user message", async () => {
    const repository = repositoryWith();
    const stream = vi
      .fn<StreamChatFunction>()
      .mockImplementationOnce(async (_request, options) => {
        options.onDelta("等等");
        throw new ChatClientError("PROVIDER_ERROR");
      })
      .mockImplementationOnce(async (_request, options) => {
        options.onDelta("我在这里~");
        return { truncated: false };
      });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-failed", "assistant-retry"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("八千代？"));
    expect(result.current).toMatchObject({ errorCode: "PROVIDER_ERROR", phase: "error" });
    expect(result.current.messages.at(-1)).toMatchObject({ status: "failed", text: "等等" });

    await act(async () => result.current.retry());

    expect(result.current.phase).toBe("idle");
    expect(result.current.messages.at(-1)).toMatchObject({
      id: "assistant-retry",
      status: "complete",
      text: "我在这里~",
    });
    const users = vi
      .mocked(repository.putMessage)
      .mock.calls.map(([message]) => message)
      .filter(({ role }) => role === "user");
    expect(users).toHaveLength(1);
    expect(stream.mock.calls[1]?.[0].messages.at(-1)).toEqual({
      role: "user",
      text: "八千代？",
    });
  });

  it("aborts the active request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const { result, unmount } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        repository: repositoryWith(),
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    act(() => {
      void result.current.send("还在吗？");
    });
    await waitFor(() => expect(capturedSignal).toBeDefined());

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("persists locale changes globally and on the active conversation", async () => {
    const repository = repositoryWith();
    const { result } = renderHook(() =>
      useChatController({ repository, streamChat: vi.fn<StreamChatFunction>() }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.setLocale("ja-JP"));

    expect(result.current.locale).toBe("ja-JP");
    expect(repository.setLocale).toHaveBeenCalledWith("ja-JP");
    expect(repository.setConversationLocale).toHaveBeenCalledWith(conversation.id, "ja-JP");
  });
});
