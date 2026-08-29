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
  formatClientTimestamp,
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
    getUserMemory: vi.fn(async () => ""),
    updateUserMemory: vi.fn(async () => undefined),
    setConversationLocale: vi.fn(async () => undefined),
    setLocale: vi.fn(async () => undefined),
    replaceMessages: vi.fn(async () => undefined),
    deleteMessagesFrom: vi.fn(async () => undefined),
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
      expect.objectContaining({
        currentTime: expect.any(String),
        locale: "zh-CN",
        messages: [
          { role: "assistant", text: greeting.text },
          { role: "user", text: "今天有点累" },
        ],
      }),
      expect.objectContaining({ onDelta: expect.any(Function), signal: expect.any(AbortSignal) }),
    );
  });

  it("marks a completed stream without any delta as a retryable provider failure", async () => {
    const repository = repositoryWith();
    const stream = vi.fn<StreamChatFunction>(async () => ({ truncated: false }));
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

    await act(async () => result.current.send("今天有点累"));

    expect(result.current.phase).toBe("error");
    expect(result.current.errorCode).toBe("PROVIDER_ERROR");
    expect(result.current.messages.at(-1)).toMatchObject({
      id: "assistant-1",
      status: "failed",
      text: "",
    });
    const persisted = vi.mocked(repository.putMessage).mock.calls.map(([message]) => message);
    expect(persisted.at(-1)).toMatchObject({
      id: "assistant-1",
      status: "failed",
      text: "",
    });
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
    // 增量压缩：边界推进到最后一条纳入摘要的消息
    expect(result.current.activeConversation?.compressedUpTo).toBe(4);
    expect(result.current.activeConversation?.compressedUpToId).toBe("a2");
    expect(repository.updateConversationSummary).toHaveBeenCalledWith(
      conversation.id,
      "用户喜欢草莓大福，两人约定明天去涉谷。",
      expect.any(Number),
      4,
      "a2",
    );
    // 模型未按区块格式输出时不写用户画像
    expect(repository.updateUserMemory).not.toHaveBeenCalled();

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

  it("compresses incrementally: only messages after the boundary are re-summarized", async () => {
    const compressedConversation: Conversation = {
      ...conversation,
      compressedUpTo: 4,
      summary: "旧记忆：用户喜欢草莓大福。",
    };
    const oldMessages: ChatMessage[] = [
      { conversationId: conversation.id, createdAt: 1, id: "u1", role: "user", text: "旧消息一", status: "complete" },
      { conversationId: conversation.id, createdAt: 2, id: "a1", role: "assistant", text: "旧回复一", status: "complete" },
      { conversationId: conversation.id, createdAt: 3, id: "u2", role: "user", text: "旧消息二", status: "complete" },
      { conversationId: conversation.id, createdAt: 4, id: "a2", role: "assistant", text: "旧回复二", status: "complete" },
    ];
    const newMessages: ChatMessage[] = [
      { conversationId: conversation.id, createdAt: 5, id: "u3", role: "user", text: "新消息一", status: "complete" },
      { conversationId: conversation.id, createdAt: 6, id: "a3", role: "assistant", text: "新回复一", status: "complete" },
    ];
    const repository = repositoryWith({
      getConversation: vi.fn(async () => compressedConversation),
      getUserMemory: vi.fn(async () => "彩叶喜欢草莓大福"),
      listConversations: vi.fn(async () => [compressedConversation]),
      listMessages: vi.fn(async () => [...oldMessages, ...newMessages]),
    });
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta(
        "<conversation_memory>合并后的完整记忆</conversation_memory>\n<user_profile>彩叶喜欢草莓大福，最近想去涉谷</user_profile>",
      );
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
    const compressionRequest = stream.mock.calls[0]?.[0];
    expect(compressionRequest?.mode).toBe("summary");
    const compressionTexts = compressionRequest?.messages.map((message) => message.text) ?? [];
    // 旧摘要与现有用户画像作为前缀注入
    expect(compressionTexts.some((text) => text.includes("旧记忆：用户喜欢草莓大福。"))).toBe(true);
    expect(compressionTexts.some((text) => text.includes("彩叶喜欢草莓大福"))).toBe(true);
    // 已压缩区间不再重复发送
    expect(compressionTexts.some((text) => text.includes("旧消息一"))).toBe(false);
    expect(compressionTexts.some((text) => text.includes("旧回复二"))).toBe(false);
    // 压缩边界之后的新消息参与合并
    expect(compressionTexts.some((text) => text.includes("新消息一"))).toBe(true);
    expect(compressionTexts.some((text) => text.includes("新回复一"))).toBe(true);

    // 双区块解析：会话记忆与用户画像分别落库
    expect(repository.updateConversationSummary).toHaveBeenCalledWith(
      conversation.id,
      "合并后的完整记忆",
      expect.any(Number),
      6,
      "a3",
    );
    expect(repository.updateUserMemory).toHaveBeenCalledWith("彩叶喜欢草莓大福，最近想去涉谷");
    expect(result.current.activeConversation?.compressedUpTo).toBe(6);
    expect(result.current.activeConversation?.compressedUpToId).toBe("a3");
    expect(result.current.userMemory).toBe("彩叶喜欢草莓大福，最近想去涉谷");

    // 后续请求：长期记忆 + 摘要前缀，且已压缩消息不重复进入历史
    await act(async () => result.current.send("继续聊"));
    const chatRequest = stream.mock.calls[1]?.[0];
    const chatTexts = chatRequest?.messages.map((message) => message.text) ?? [];
    expect(chatTexts.some((text) => text.includes("【关于彩叶的长期记忆"))).toBe(true);
    expect(chatTexts.some((text) => text.includes("彩叶喜欢草莓大福，最近想去涉谷"))).toBe(true);
    expect(chatTexts.some((text) => text.includes("【前情提要"))).toBe(true);
    expect(chatTexts.some((text) => text.includes("旧消息一"))).toBe(false);
    expect(chatRequest?.messages.at(-1)).toEqual({ role: "user", text: "继续聊" });
  });

  it("loads persisted user memory and injects it into new conversations (cold start)", async () => {
    const repository = repositoryWith({
      getUserMemory: vi.fn(async () => "彩叶的名字是酒寄彩叶，喜欢草莓大福"),
      listConversations: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
    });
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta("好呀~");
      return { truncated: false };
    });

    const { result } = renderHook(() =>
      useChatController({ id: ids("user-1", "assistant-1"), repository, streamChat: stream }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.userMemory).toBe("彩叶的名字是酒寄彩叶，喜欢草莓大福");

    await act(async () => result.current.send("你好"));

    const chatRequest = stream.mock.calls[0]?.[0];
    expect(chatRequest?.messages[0]).toEqual({
      role: "user",
      text: expect.stringContaining("【关于彩叶的长期记忆"),
    });
    expect(chatRequest?.messages[0]?.text).toContain("彩叶的名字是酒寄彩叶，喜欢草莓大福");
    expect(chatRequest?.messages[1]).toEqual({
      role: "assistant",
      text: "（关于彩叶的事情，我一直都记得哦~）",
    });
  });

  it("updates user memory through the controller and reflects the change", async () => {
    const repository = repositoryWith();
    const { result } = renderHook(() =>
      useChatController({ id: ids(), repository, streamChat: vi.fn<StreamChatFunction>() }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    let saved = false;
    await act(async () => {
      saved = await result.current.updateUserMemory("  彩叶喜欢猫  ");
    });

    expect(saved).toBe(true);
    expect(repository.updateUserMemory).toHaveBeenCalledWith("彩叶喜欢猫");
    expect(result.current.userMemory).toBe("彩叶喜欢猫");
  });

  it("prepends active skill instructions as the leading request messages", async () => {
    const repository = repositoryWith();
    const stream = vi.fn<StreamChatFunction>(async () => ({ truncated: false }));

    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        repository,
        streamChat: stream,
        activeSkills: [
          {
            id: "humanizer",
            name: "Humanizer",
            description: "去除文本中的 AI 味",
            content: "# Humanizer\n四层自检体系：L1 硬性规则零容忍。",
          },
        ],
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("帮我改写这段话"));

    const chatRequest = stream.mock.calls[0]?.[0];
    expect(chatRequest?.messages[0]).toEqual({
      role: "user",
      text: expect.stringContaining("【技能指令 / Skill Instructions】"),
    });
    expect(chatRequest?.messages[0]?.text).toContain("L1 硬性规则零容忍。");
    expect(chatRequest?.messages[1]).toEqual({
      role: "assistant",
      text: "（已收到技能指令，将严格遵守执行）",
    });
    expect(chatRequest?.messages.at(-1)).toEqual({
      role: "user",
      text: "帮我改写这段话",
    });
  });

  it("sends webSearch flag when enabled and persists sources received before deltas", async () => {
    const repository = repositoryWith();
    const sources = [
      { title: "必应搜索结果一", url: "https://www.bing.com/" },
      { title: "必应搜索结果二", url: "https://cn.bing.com/" },
    ];
    const stream = vi.fn<StreamChatFunction>(async (request, options) => {
      expect(request.webSearch).toBe(true);
      options.onSources?.(sources);
      options.onDelta("基于搜索的回复");
      return { truncated: false };
    });
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        repository,
        streamChat: stream,
        webSearchEnabled: true,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => result.current.send("今天上海天气怎么样"));

    const chatRequest = stream.mock.calls[0]?.[0];
    expect(chatRequest?.webSearch).toBe(true);
    expect(result.current.messages.at(-1)).toMatchObject({
      status: "complete",
      sources,
      text: "基于搜索的回复",
    });
    // 最终持久化的消息包含 sources
    expect(vi.mocked(repository.putMessage).mock.calls.at(-1)?.[0]).toMatchObject({
      id: "assistant-1",
      sources,
    });
  });

  it("omits the webSearch flag on summary compression requests even when enabled", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
      conversationId: conversation.id,
      createdAt: 20 + index,
      id: `history-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      status: "complete",
      text: `消息 ${index}`,
    }));
    const repository = repositoryWith({ listMessages: vi.fn(async () => messages) });
    const stream = vi.fn<StreamChatFunction>(async () => ({ truncated: false }));
    const { result } = renderHook(() =>
      useChatController({
        id: ids("user-1", "assistant-1"),
        repository,
        streamChat: stream,
        webSearchEnabled: true,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    // 触发 20 条上限 → 先压缩（summary）再聊天
    await act(async () => result.current.send("次"));

    const summaryRequest = stream.mock.calls[0]?.[0];
    expect(summaryRequest?.mode).toBe("summary");
    expect(summaryRequest?.webSearch).toBeUndefined();

    const chatRequest = stream.mock.calls[1]?.[0];
    expect(chatRequest?.mode).toBeUndefined();
    expect(chatRequest?.webSearch).toBe(true);
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
    // 撤回 = 水位线定点删除（从被撤回的用户消息起），不再重写保留区
    const recalledCreatedAt = vi
      .mocked(repository.putMessage)
      .mock.calls.map(([message]) => message)
      .find((message) => message.role === "user")?.createdAt;
    expect(recalledCreatedAt).toBeGreaterThan(greeting.createdAt);
    expect(repository.deleteMessagesFrom).toHaveBeenCalledWith(
      conversation.id,
      recalledCreatedAt,
    );
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
    // 重新生成 = 水位线定点删除（从被重生成的 assistant-1 起）
    const putMessages = vi
      .mocked(repository.putMessage)
      .mock.calls.map(([message]) => message);
    const assistantOneCreatedAt = putMessages.find((message) => message.id === "assistant-1")
      ?.createdAt;
    expect(assistantOneCreatedAt).toBeGreaterThan(greeting.createdAt);
    const regenerated = vi
      .mocked(repository.deleteMessagesFrom)
      .mock.calls.filter(
        (call) => call[0] === conversation.id && call[1] === assistantOneCreatedAt,
      );
    expect(regenerated).toHaveLength(1);
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

  it("accumulates thought deltas and records provider/model snapshot, usage and latencyMs", async () => {
    const repository = repositoryWith();
    const stream = vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onThought?.("思考中...");
      options.onThought?.("继续思考...");
      options.onDelta("这是最终回复");
      return {
        truncated: false,
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      };
    });

    const { result } = renderHook(() =>
      useChatController({
        activeLlmConfig: { apiKey: "sk-test-12345678901234567890", model: "claude-sonnet-5", provider: "claude" },
        id: ids("user-1", "assistant-1"),
        now: () => 1000,
        repository,
        streamChat: stream,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => {
      await result.current.send("你好");
    });

    const assistantMsg = result.current.messages.find((m) => m.id === "assistant-1");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.text).toBe("这是最终回复");
    expect(assistantMsg?.thought).toBe("思考中...继续思考...");
    expect(assistantMsg?.provider).toBe("claude");
    expect(assistantMsg?.model).toBe("claude-sonnet-5");
    expect(assistantMsg?.usage).toEqual({ promptTokens: 50, completionTokens: 20, totalTokens: 70 });
    expect(typeof assistantMsg?.latencyMs).toBe("number");
  });

  it("windows initial history and loads earlier pages on demand with an exclusive boundary", async () => {
    // 60 条历史（createdAt 10..69）：初始窗口应只保留最近 50 条，更早 10 条经上翻加载
    const pool: ChatMessage[] = Array.from({ length: 60 }, (_, index) => ({
      conversationId: conversation.id,
      createdAt: 10 + index,
      id: `history-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      status: "complete",
      text: `历史 ${index}`,
    }));
    const repository = repositoryWith({
      listMessages: vi.fn(
        async (
          conversationId: string,
          options?: { beforeCreatedAt?: number; limit?: number },
        ) => {
          const all = pool
            .filter((message) => message.conversationId === conversationId)
            .sort((left, right) => left.createdAt - right.createdAt);
          // 先提取上界到局部常量：属性收窄不会跨闭包保留
          const before = options?.beforeCreatedAt;
          const bounded =
            before === undefined ? all : all.filter((message) => message.createdAt < before);
          if (options?.limit === undefined || bounded.length <= options.limit) {
            return bounded;
          }
          // 与真实仓库一致：带 limit 时返回区间内最靠近上界的 N 条（升序）
          return bounded.slice(bounded.length - options.limit);
        },
      ),
    });

    const { result } = renderHook(() =>
      useChatController({
        id: ids("unused-user", "unused-assistant"),
        repository,
        streamChat: vi.fn<StreamChatFunction>(),
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    // 初载：窗口 50 + 探测 1
    expect(vi.mocked(repository.listMessages).mock.calls[0]).toEqual([
      conversation.id,
      { limit: 51 },
    ]);
    expect(result.current.messages).toHaveLength(50);
    expect(result.current.messages[0]?.createdAt).toBe(20);
    expect(result.current.messages.at(-1)?.createdAt).toBe(69);
    expect(result.current.hasMoreHistory).toBe(true);

    // 上翻：排他上界 = 当前窗口最早一条（20），应取回 10..19 共 10 条
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(
      vi.mocked(repository.listMessages).mock.calls.at(-1),
    ).toEqual([conversation.id, { beforeCreatedAt: 20, limit: 30 }]);
    expect(result.current.messages).toHaveLength(60);
    expect(result.current.messages[0]?.createdAt).toBe(10);
    const loadedIds = result.current.messages.map((message) => message.id);
    expect(new Set(loadedIds).size).toBe(loadedIds.length);

    // 再上翻：区间为空时不触发重渲染，标志保持不变
    const before = result.current.messages;
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.messages).toBe(before);
    expect(result.current.hasMoreHistory).toBe(true);
  });

  it("clears hasMoreHistory when switching to a conversation without earlier history", async () => {
    const shortConversation = { ...conversation, id: "conversation-short" };
    const shortMessage: ChatMessage = {
      conversationId: shortConversation.id,
      createdAt: 100,
      id: "only-1",
      role: "user",
      status: "complete",
      text: "唯一一条",
    };
    const pool: ChatMessage[] = Array.from({ length: 60 }, (_, index) => ({
      conversationId: conversation.id,
      createdAt: 10 + index,
      id: `history-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      status: "complete",
      text: `历史 ${index}`,
    }));
    const repository = repositoryWith({
      getConversation: vi.fn(async (id: string) =>
        id === conversation.id ? conversation : id === shortConversation.id ? shortConversation : undefined,
      ),
      listMessages: vi.fn(async (conversationId: string) =>
        conversationId === shortConversation.id
          ? [shortMessage]
          : pool.filter((message) => message.conversationId === conversationId),
      ),
    });

    const { result } = renderHook(() =>
      useChatController({
        id: ids("unused-user", "unused-assistant"),
        repository,
        streamChat: vi.fn<StreamChatFunction>(),
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.hasMoreHistory).toBe(true);

    await act(async () => {
      await result.current.selectConversation(shortConversation.id);
    });
    expect(result.current.activeConversation?.id).toBe(shortConversation.id);
    expect(result.current.messages).toEqual([shortMessage]);
    // 标志以“字段缺席”方式清除（undefined），避免残留上一会话的 true
    expect(result.current.hasMoreHistory).toBeUndefined();
  });

  it("formats client timestamps localized to Chinese and Japanese", () => {
    // 2026-08-27 11:09:37 (Thursday / 木曜日)
    // Note: Date constructor with UTC or local
    const sampleDate = new Date(2026, 7, 27, 11, 9, 37);
    const zh = formatClientTimestamp(sampleDate.getTime(), "zh-CN");
    expect(zh).toBe("2026-08-27 11:09:37 星期四");

    const ja = formatClientTimestamp(sampleDate.getTime(), "ja-JP");
    expect(ja).toBe("2026-08-27 11:09:37 木曜日");
  });

  it("passes formatted currentTime when sending messages via streamChat", async () => {
    const streamChat = vi.fn<StreamChatFunction>(async (_req, options) => {
      options.onDelta("收到！");
      return { truncated: false };
    });
    const fixedNow = new Date(2026, 7, 27, 11, 9, 37).getTime();

    const { result } = renderHook(() =>
      useChatController({
        id: () => "msg-1",
        now: () => fixedNow,
        repository: repositoryWith(),
        streamChat,
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => {
      await result.current.send("你好");
    });

    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTime: "2026-08-27 11:09:37 星期四",
        locale: "zh-CN",
      }),
      expect.anything(),
    );
  });
});
