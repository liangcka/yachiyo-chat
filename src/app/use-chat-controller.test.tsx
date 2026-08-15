import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";
import { copyFor } from "../i18n/messages";
import {
  ChatClientError,
  type StreamChatOptions,
  type StreamChatRequest,
  type StreamChatResult,
} from "../services/chat-client";
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
    updateConversationSummary: vi.fn(async () => undefined),
    setConversationLocale: vi.fn(async () => undefined),
    setLocale: vi.fn(async () => undefined),
    replaceMessages: vi.fn(async () => undefined),
    ...overrides,
  };
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${index}`;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useChatController", () => {
  it("creates a new conversation when history is empty", async () => {
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
    expect(result.current.messages).toEqual([]);
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

  it("cancels a send that is still persisting before switching conversations", async () => {
    const firstWrite = deferred();
    let writeCount = 0;
    const nextConversation = { ...conversation, id: "conversation-2", title: "新的对话 2" };
    const repository = repositoryWith({
      createConversation: vi.fn(async () => nextConversation),
      putMessage: vi.fn(async () => {
        writeCount += 1;
        if (writeCount === 1) await firstWrite.promise;
      }),
    });
    const stream = vi.fn<StreamChatFunction>(async () => ({ truncated: false }));
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1", "new-greeting"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("不要串到下一段对话");
    });
    await waitFor(() => expect(result.current.phase).toBe("streaming"));

    let switchPromise = Promise.resolve();
    act(() => {
      switchPromise = result.current.newConversation();
    });
    expect(repository.createConversation).not.toHaveBeenCalled();

    firstWrite.resolve();
    await act(async () => {
      await Promise.all([sendPromise, switchPromise]);
    });

    expect(stream).not.toHaveBeenCalled();
    expect(result.current.activeConversation?.id).toBe(nextConversation.id);
    expect(result.current.messages).toEqual([]);
    expect(vi.mocked(repository.putMessage).mock.calls.map(([message]) => message)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conversationId: conversation.id, id: "user-1" }),
        expect.objectContaining({ conversationId: conversation.id, id: "assistant-1", status: "stopped" }),
      ]),
    );
  });

  it("keeps request history within both the 20-message and 24000-character limits", async () => {
    const longHistory: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
      conversationId: conversation.id,
      createdAt: 20 + index,
      id: `history-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      status: "complete",
      text: "界".repeat(4_000),
    }));
    const repository = repositoryWith({ listMessages: vi.fn(async () => longHistory) });
    const stream = vi.fn<StreamChatFunction>(async () => ({ truncated: false }));
    const { result } = renderHook(() =>
      useChatController({ id: ids("user-1", "assistant-1"), repository, streamChat: stream }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("次"));

    const compressionRequest = stream.mock.calls[0]?.[0];
    expect(compressionRequest?.mode).toBe("summary");
    expect(compressionRequest?.messages.length).toBeLessThanOrEqual(20);
    expect(
      compressionRequest?.messages.reduce((total, message) => total + [...message.text].length, 0),
    ).toBeLessThanOrEqual(24_000);
    expect(compressionRequest?.messages.at(-1)?.role).toBe("user");

    const chatRequest = stream.mock.calls[1]?.[0];
    expect(chatRequest?.messages.length).toBeLessThanOrEqual(20);
    expect(
      chatRequest?.messages.reduce((total, message) => total + [...message.text].length, 0),
    ).toBeLessThanOrEqual(24_000);
    expect(chatRequest?.messages.at(-1)).toEqual({ role: "user", text: "次" });
  });

  it("compresses context non-destructively and injects memory on subsequent turns", async () => {
    const messages: ChatMessage[] = [
      { conversationId: conversation.id, createdAt: 1, id: "u1", role: "user", text: "我喜欢草莓大福", status: "complete" },
      { conversationId: conversation.id, createdAt: 2, id: "a1", role: "assistant", text: "记住了~", status: "complete" },
      { conversationId: conversation.id, createdAt: 3, id: "u2", role: "user", text: "明天去涉谷逛街", status: "complete" },
      { conversationId: conversation.id, createdAt: 4, id: "a2", role: "assistant", text: "好呀！", status: "complete" },
    ];
    const repository = repositoryWith({ listMessages: vi.fn(async () => messages) });
    const stream = vi.fn<StreamChatFunction>()
      .mockImplementationOnce(async (_request, options) => {
        options.onDelta("用户喜欢草莓大福，两人约定明天去涉谷。");
        return { truncated: false };
      })
      .mockImplementationOnce(async (_request, options) => {
        options.onDelta("涉谷见~");
        return { truncated: false };
      });

    const { result } = renderHook(() =>
      useChatController({ id: ids("user-new", "assistant-new"), repository, streamChat: stream }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let compressSuccess = false;
    await act(async () => {
      compressSuccess = await result.current.compressConversation();
    });

    expect(compressSuccess).toBe(true);
    // Messages must NOT be destroyed!
    expect(result.current.messages).toHaveLength(4);
    expect(result.current.activeConversation?.summary).toBe("用户喜欢草莓大福，两人约定明天去涉谷。");
    expect(repository.updateConversationSummary).toHaveBeenCalledWith(
      conversation.id,
      "用户喜欢草莓大福，两人约定明天去涉谷。",
      expect.any(Number),
    );

    // Now send another message, verify summary is injected in request turns
    await act(async () => result.current.send("天气怎么样？"));

    const chatRequest = stream.mock.calls[1]?.[0];
    expect(chatRequest?.messages[0]).toEqual({
      role: "user",
      text: expect.stringContaining("用户喜欢草莓大福，两人约定明天去涉谷。"),
    });
    expect(chatRequest?.messages[1]).toEqual({
      role: "assistant",
      text: "（已记住我们之前的对话与经历，继续交流~）",
    });
    expect(chatRequest?.messages.at(-1)).toEqual({
      role: "user",
      text: "天气怎么样？",
    });
  });

  it("recovers an interrupted persisted assistant as stopped on startup", async () => {
    const interrupted: ChatMessage = {
      ...greeting,
      createdAt: 12,
      id: "interrupted",
      status: "streaming",
      text: "还没说完",
    };
    const repository = repositoryWith({
      listMessages: vi.fn(async () => [greeting, interrupted]),
    });
    const { result } = renderHook(() =>
      useChatController({ repository, streamChat: vi.fn<StreamChatFunction>() }),
    );

    await waitFor(() => expect(result.current.phase).toBe("idle"));

    expect(result.current.messages.at(-1)).toMatchObject({ id: "interrupted", status: "stopped" });
    expect(repository.putMessage).toHaveBeenCalledWith({ ...interrupted, status: "stopped" });
  });

  it("uses and synchronizes the selected latest conversation locale on startup", async () => {
    const japaneseConversation = { ...conversation, locale: "ja-JP" as const };
    const repository = repositoryWith({
      getLocale: vi.fn(async () => "zh-CN" as const),
      listConversations: vi.fn(async () => [japaneseConversation]),
    });
    const { result } = renderHook(() =>
      useChatController({ repository, streamChat: vi.fn<StreamChatFunction>() }),
    );

    await waitFor(() => expect(result.current.phase).toBe("idle"));

    expect(result.current.locale).toBe("ja-JP");
    expect(repository.setLocale).toHaveBeenCalledWith("ja-JP");
  });

  it("does not retry non-retryable request errors", async () => {
    const stream = vi.fn<StreamChatFunction>(async () => {
      throw new ChatClientError("INVALID_REQUEST");
    });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1", "assistant-2"),
        repository: repositoryWith(),
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => result.current.send("测试"));

    await act(async () => result.current.retry());

    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("preserves the user text when local image storage fails", async () => {
    const image: StoredImage = {
      blob: new Blob(["image"], { type: "image/jpeg" }),
      conversationId: conversation.id,
      height: 10,
      id: "image-1",
      mimeType: "image/jpeg",
      width: 10,
    };
    const repository = repositoryWith({
      putImage: vi.fn(async () => {
        throw new Error("storage full");
      }),
    });
    const stream = vi.fn<StreamChatFunction>();
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    act(() => result.current.setPendingImage(image));
    await act(async () => result.current.send("至少保留文字"));

    expect(repository.putMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1", role: "user", text: "至少保留文字" }),
    );
    expect(result.current).toMatchObject({ errorCode: "STORAGE_ERROR", phase: "error" });
    expect(stream).not.toHaveBeenCalled();
  });

  it("recalls the latest user message and following assistant message, updating repository", async () => {
    const repository = repositoryWith();
    const stream = vi.fn<StreamChatFunction>(async (_req, options) => {
      options.onDelta("回复内容");
      return { truncated: false };
    });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("想要撤回的消息"));
    expect(result.current.messages).toHaveLength(3); // greeting, user-1, assistant-1

    let recalledData: unknown;
    await act(async () => {
      recalledData = await result.current.recall();
    });

    expect(recalledData).toEqual({
      imageId: undefined,
      text: "想要撤回的消息",
    });
    expect(result.current.messages).toEqual([greeting]);
    expect(repository.replaceMessages).toHaveBeenCalledWith(conversation.id, [greeting]);
  });

  it("aborts active streaming when recall is called", async () => {
    const repository = repositoryWith();
    let aborted = false;
    const stream = vi.fn<StreamChatFunction>(async (_req, options) => {
      options.onDelta("正在生成中...");
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
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
      sendPromise = result.current.send("流式测试");
    });
    await waitFor(() => expect(result.current.messages.at(-1)?.text).toBe("正在生成中..."));

    await act(async () => {
      await result.current.recall();
      await sendPromise.catch(() => undefined);
    });

    expect(aborted).toBe(true);
    expect(result.current.messages).toEqual([greeting]);
    expect(result.current.phase).toBe("idle");
  });

  it("returns undefined and does nothing when there are no user messages to recall", async () => {
    const repository = repositoryWith();
    const { result } = renderHook(() =>
      useChatController({
        repository,
        streamChat: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let recalled: unknown;
    await act(async () => {
      recalled = await result.current.recall();
    });

    expect(recalled).toBeUndefined();
    expect(repository.replaceMessages).not.toHaveBeenCalled();
  });

  it("regenerates the latest assistant response based on preceding history", async () => {
    const repository = repositoryWith();
    let callCount = 0;
    const stream = vi.fn<StreamChatFunction>(async (_req, options) => {
      callCount += 1;
      options.onDelta(callCount === 1 ? "第一遍回复" : "重新生成后的回复");
      return { truncated: false };
    });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1", "assistant-2"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("你好"));
    expect(result.current.messages).toHaveLength(3); // greeting, user-1, assistant-1
    expect(result.current.messages[2]?.text).toBe("第一遍回复");

    await act(async () => result.current.regenerate());
    expect(result.current.messages).toHaveLength(3); // greeting, user-1, assistant-2
    expect(result.current.messages[2]?.text).toBe("重新生成后的回复");
    expect(result.current.messages[2]?.id).toBe("assistant-2");
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("includes image data url when regenerating assistant response for an image user message", async () => {
    const image: StoredImage = {
      blob: new Blob(["image-content"], { type: "image/jpeg" }),
      conversationId: conversation.id,
      height: 10,
      id: "image-1",
      mimeType: "image/jpeg",
      width: 10,
    };
    let storedImage: StoredImage | undefined;
    const repository = repositoryWith({
      getImage: vi.fn(async (id: string) => (id === "image-1" ? storedImage : undefined)),
      putImage: vi.fn(async (img: StoredImage) => {
        storedImage = img;
      }),
    });
    const stream = vi.fn<StreamChatFunction>(async (_req, options) => {
      options.onDelta("回复");
      return { truncated: false };
    });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1", "assistant-2"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    act(() => result.current.setPendingImage(image));
    await act(async () => result.current.send("看图"));

    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[0].messages.at(-1)?.imageDataUrl).toBeDefined();

    await act(async () => result.current.regenerate());

    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]?.[0].messages.at(-1)?.imageDataUrl).toBeDefined();
  });


  it("regenerates a specific assistant message by messageId and trims following messages", async () => {
    const repository = repositoryWith();
    let callCount = 0;
    const stream = vi.fn<StreamChatFunction>(async (_req, options) => {
      callCount += 1;
      options.onDelta(`回复 #${callCount}`);
      return { truncated: false };
    });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1", "user-2", "assistant-2", "assistant-3"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("问题一"));
    await act(async () => result.current.send("问题二"));
    expect(result.current.messages).toHaveLength(5); // greeting, user-1, assistant-1, user-2, assistant-2

    // Regenerate from assistant-1
    await act(async () => result.current.regenerate("assistant-1"));
    expect(result.current.messages).toHaveLength(3); // greeting, user-1, assistant-3
    expect(result.current.messages[2]?.id).toBe("assistant-3");
    expect(result.current.messages[2]?.text).toBe("回复 #3");
    expect(repository.replaceMessages).toHaveBeenCalledWith(conversation.id, [
      greeting,
      expect.objectContaining({ id: "user-1" }),
    ]);
  });

  it("aborts active compression when stop is called and returns to idle", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
      conversationId: conversation.id,
      createdAt: 20 + index,
      id: `history-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      status: "complete",
      text: `消息 ${index}`,
    }));
    const repository = repositoryWith({ listMessages: vi.fn(async () => messages) });
    let compressionSignal: AbortSignal | undefined;
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      if (request.mode === "summary") {
        compressionSignal = options.signal;
        options.onDelta("压缩中...");
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      return { truncated: false };
    });

    const { result } = renderHook(() =>
      useChatController({
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let compressPromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      compressPromise = result.current.compressConversation();
    });
    await waitFor(() => expect(result.current.phase).toBe("compressing"));
    expect(compressionSignal).toBeDefined();

    await act(async () => {
      await result.current.stop();
      await compressPromise;
    });

    expect(compressionSignal?.aborted).toBe(true);
    expect(result.current.phase).toBe("idle");
    expect(repository.updateConversationSummary).not.toHaveBeenCalled();
  });

  it("terminates send without writing to new conversation if conversation is switched during compression", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
      conversationId: conversation.id,
      createdAt: 20 + index,
      id: `history-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      status: "complete",
      text: `消息 ${index}`,
    }));
    const nextConversation = { ...conversation, id: "conversation-2", title: "新的对话 2" };
    const repository = repositoryWith({
      createConversation: vi.fn(async () => nextConversation),
      listMessages: vi.fn(async () => messages),
    });

    const compressionDeferred = deferred<StreamChatResult>();
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      if (request.mode === "summary") {
        options.signal?.addEventListener("abort", () => {
          compressionDeferred.reject(new DOMException("Aborted", "AbortError"));
        });
        return compressionDeferred.promise;
      }
      return { truncated: false };
    });

    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-new", "assistant-new"),
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("新发送的消息");
    });
    await waitFor(() => expect(result.current.phase).toBe("compressing"));

    // User creates a new conversation while compression is in flight
    await act(async () => {
      await result.current.newConversation();
      await sendPromise.catch(() => undefined);
    });

    expect(result.current.activeConversation?.id).toBe(nextConversation.id);
    expect(result.current.messages).toEqual([]);
    // Ensure the message wasn't saved into the new conversation
    const putCalls = vi.mocked(repository.putMessage).mock.calls.map(([msg]) => msg);
    expect(putCalls.filter((m) => m.conversationId === nextConversation.id)).toHaveLength(0);
  });
});
