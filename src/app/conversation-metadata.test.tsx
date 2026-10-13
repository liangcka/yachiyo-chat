import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRepository } from "../data/conversation-repository";
import { YachiyoDatabase } from "../data/db";
import { useChatController, type StreamChatFunction } from "./use-chat-controller";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("对话完成后的后台整理", () => {
  let db: YachiyoDatabase;
  let repository: ConversationRepository;

  beforeEach(() => {
    db = new YachiyoDatabase(`metadata-${crypto.randomUUID()}`);
    repository = new ConversationRepository(db);
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  function model(metadata = '{"title":"草莓与日常","memory":"喜欢草莓"}') {
    return vi.fn<StreamChatFunction>(async (request, options) => {
      options.onDelta(request.mode === "metadata" ? metadata : "记住啦。");
      return { truncated: false };
    });
  }

  it("首轮完整回复后生成标题和记忆，后续不重复改名", async () => {
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(result.current.userMemory).toBe("喜欢草莓"));
    expect(result.current.activeConversation?.title).toBe("草莓与日常");
    expect(await repository.getUserMemory()).toBe("喜欢草莓");
    await act(() => result.current.send("今天也想吃"));
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(4));
    const request = streamChat.mock.calls[3]![0];
    expect(request.mode).toBe("metadata");
    expect(JSON.parse(request.messages[0]!.text)).toMatchObject({ generateTitle: false });
    expect(request.webSearch).toBeUndefined();
    expect(result.current.messages).toHaveLength(4);
  });

  it("后台请求不阻塞下一轮，手动清除会取消尚未写入的记忆", async () => {
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const streamChat = vi.fn<StreamChatFunction>(async (request, options) => {
      if (request.mode !== "metadata") {
        options.onDelta("知道啦。");
        return { truncated: false };
      }
      signal = options.signal;
      await new Promise<void>((resolve) => { finish = resolve; });
      options.onDelta('{"title":"喜欢草莓","memory":"喜欢草莓"}');
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(finish).toBeDefined());
    expect(result.current.phase).toBe("idle");
    await act(() => result.current.updateUserMemory(""));
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish!(); });
    expect(await repository.getUserMemory()).toBe("");
    expect(result.current.userMemory).toBe("");
  });

  it.each(["非 JSON", '{"title":"新标题","memory":12}'])("忽略非法整理结果 %s", async (output) => {
    const streamChat = model(output);
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(result.current.activeConversation?.title).toBe("新的对话");
    expect(await repository.getUserMemory()).toBe("");
    expect(result.current.errorCode).toBeUndefined();
  });

  it("拒绝被截断的整理响应", async () => {
    const streamChat = vi.fn<StreamChatFunction>(async (request, options) => {
      options.onDelta(request.mode === "metadata" ? '{"title":"草莓","memory":"喜欢草莓"}' : "好呀");
      return { truncated: request.mode === "metadata" };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2));
    expect(await repository.getUserMemory()).toBe("");
    expect(result.current.activeConversation?.title).toBe("新的对话");
  });

  it("完整回复等待落库时停止，不会在落库后启动整理", async () => {
    const persistence = deferred();
    const originalPutMessage = repository.putMessage.bind(repository);
    const putMessage = vi.spyOn(repository, "putMessage").mockImplementation(async (message) => {
      if (message.role === "assistant" && message.status === "complete") await persistence.promise;
      await originalPutMessage(message);
    });
    const readMemory = vi.spyOn(repository, "getUserMemory");
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    readMemory.mockClear();
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("我喜欢草莓"); });
    await waitFor(() => expect(putMessage.mock.calls.some(([message]) =>
      message.role === "assistant" && message.status === "complete",
    )).toBe(true));
    let stopping: Promise<void> | undefined;
    act(() => { stopping = result.current.stop(); });
    await act(async () => {
      persistence.resolve();
      await Promise.all([sending, stopping]);
    });
    expect(readMemory).not.toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("切换和新建会话继续使用已保存的长期记忆", async () => {
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    const firstId = result.current.activeConversation!.id;
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(result.current.userMemory).toBe("喜欢草莓"));
    await act(() => result.current.newConversation());
    expect(result.current.activeConversation?.id).not.toBe(firstId);
    expect(result.current.userMemory).toBe("喜欢草莓");
    await act(() => result.current.selectConversation(firstId));
    expect(result.current.userMemory).toBe("喜欢草莓");
    await act(() => result.current.send("还记得我喜欢什么吗"));
    const chatRequests = streamChat.mock.calls.filter(([request]) => request.mode !== "metadata");
    expect(chatRequests[1]![0].messages.some((message) => message.text.includes("喜欢草莓"))).toBe(true);
  });

  it("新会话整理只接收自己的旧事实，聊天请求仍共享所有来源", async () => {
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(result.current.userMemory).toBe("喜欢草莓"));
    await act(() => result.current.newConversation());
    await act(() => result.current.send("我住在东京"));
    await waitFor(() => expect(streamChat.mock.calls.filter(([request]) => request.mode === "metadata")).toHaveLength(2));
    const metadata = streamChat.mock.calls.filter(([request]) => request.mode === "metadata").at(-1)![0];
    expect(JSON.parse(metadata.messages[0]!.text)).toMatchObject({ existingMemory: "" });
    const chat = streamChat.mock.calls.filter(([request]) => request.mode !== "metadata").at(-1)![0];
    expect(chat.messages.some(({ text }) => text.includes("喜欢草莓"))).toBe(true);
  });

  it.each(["停止", "卸载", "切换会话", "删除会话"] as const)("%s会取消未完成的整理，迟到结果不写入", async (action) => {
    const response = deferred();
    let metadataSignal: AbortSignal | undefined;
    let metadataTask: Promise<{ truncated: boolean }> | undefined;
    const applyMetadata = vi.spyOn(repository, "applyConversationMetadata");
    const streamChat = vi.fn<StreamChatFunction>((request, options) => {
      if (request.mode !== "metadata") {
        options.onDelta("知道啦。");
        return Promise.resolve({ truncated: false });
      }
      metadataSignal = options.signal;
      metadataTask = response.promise.then(() => {
        options.onDelta('{"title":"草莓","memory":"喜欢草莓"}');
        return { truncated: false };
      });
      return metadataTask;
    });
    const { result, unmount } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    const originalId = result.current.activeConversation!.id;
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(metadataSignal).toBeDefined());
    if (action === "卸载") unmount();
    else if (action === "停止") await act(() => result.current.stop());
    else if (action === "删除会话") await act(() => result.current.deleteConversation(originalId));
    else {
      const other = await repository.createConversation("zh-CN");
      await act(() => result.current.selectConversation(other.id));
    }
    expect(metadataSignal!.aborted).toBe(true);
    await act(async () => {
      response.resolve();
      await metadataTask;
    });
    expect(applyMetadata).not.toHaveBeenCalled();
    expect(await repository.getUserMemory()).toBe("");
    expect((await repository.getConversation(originalId))?.title).toBe(action === "删除会话" ? undefined : "新的对话");
  });

  it.each(["停止", "卸载"] as const)("回复仍在流式传输时%s，不启动整理", async (action) => {
    const response = deferred();
    let chatSignal: AbortSignal | undefined;
    const readMemory = vi.spyOn(repository, "getUserMemory");
    const streamChat = vi.fn<StreamChatFunction>(async (_request, options) => {
      chatSignal = options.signal;
      options.onDelta("知道");
      await response.promise;
      return { truncated: false };
    });
    const { result, unmount } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    readMemory.mockClear();
    let sending: Promise<void> | undefined;
    act(() => { sending = result.current.send("我喜欢草莓"); });
    await waitFor(() => expect(chatSignal).toBeDefined());
    if (action === "卸载") unmount();
    else await act(() => result.current.stop());
    expect(chatSignal!.aborted).toBe(true);
    await act(async () => {
      response.resolve();
      await sending;
    });
    expect(readMemory).not.toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it.each(["失败", "空回复", "截断"] as const)("%s的聊天回复不启动整理", async (outcome) => {
    const streamChat = vi.fn<StreamChatFunction>(async (_request, options) => {
      if (outcome !== "空回复") options.onDelta("还没有说完");
      if (outcome === "失败") throw new Error("服务不可用");
      return { truncated: outcome === "截断" };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(await repository.getUserMemory()).toBe("");
    expect(result.current.activeConversation?.title).toBe("新的对话");
  });

  it("下一轮会取消上一轮整理，迟到结果不会覆盖新的记忆", async () => {
    const firstResponse = deferred();
    let firstSignal: AbortSignal | undefined;
    let firstMetadataTask: Promise<{ truncated: boolean }> | undefined;
    let metadataCount = 0;
    const streamChat = vi.fn<StreamChatFunction>((request, options) => {
      if (request.mode !== "metadata") {
        options.onDelta("知道啦。");
        return Promise.resolve({ truncated: false });
      }
      metadataCount += 1;
      if (metadataCount === 1) {
        firstSignal = options.signal;
        firstMetadataTask = firstResponse.promise.then(() => {
          options.onDelta('{"title":"草莓","memory":"喜欢草莓"}');
          return { truncated: false };
        });
        return firstMetadataTask;
      }
      options.onDelta('{"title":"水果偏好","memory":"喜欢蓝莓"}');
      return Promise.resolve({ truncated: false });
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(firstSignal).toBeDefined());
    await act(() => result.current.send("现在更喜欢蓝莓"));
    await waitFor(() => expect(result.current.userMemory).toBe("喜欢蓝莓"));
    expect(firstSignal!.aborted).toBe(true);
    await act(async () => {
      firstResponse.resolve();
      await firstMetadataTask;
    });
    expect(await repository.getUserMemory()).toBe("喜欢蓝莓");
    expect(result.current.activeConversation?.title).toBe("水果偏好");
  });

  it("整理请求期间手动改名，保留手动标题并照常更新记忆", async () => {
    const response = deferred();
    let metadataStarted = false;
    const streamChat = vi.fn<StreamChatFunction>(async (request, options) => {
      if (request.mode !== "metadata") options.onDelta("知道啦。");
      else {
        metadataStarted = true;
        await response.promise;
        options.onDelta('{"title":"自动标题","memory":"喜欢草莓"}');
      }
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    const conversationId = result.current.activeConversation!.id;
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(metadataStarted).toBe(true));
    await repository.renameConversation(conversationId, "手动标题");
    await act(async () => { response.resolve(); });
    await waitFor(() => expect(result.current.userMemory).toBe("喜欢草莓"));
    expect(await repository.getConversation(conversationId)).toMatchObject({ title: "手动标题", titleSource: "manual" });
  });

  it.each(["记".repeat(2001), "\u0000".repeat(600)])("独立记忆超出自动更新预算时仍可整理当前来源，保留独立记忆", async (memory) => {
    await repository.updateUserMemory(memory);
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(result.current.activeConversation?.title).toBe("草莓与日常"));
    const request = streamChat.mock.calls.find(([request]) => request.mode === "metadata")![0];
    expect(JSON.parse(request.messages[0]!.text)).toMatchObject({ updateMemory: true, existingMemory: "" });
    expect(request.messages.every((message) => [...message.text].length <= 4000)).toBe(true);
    await waitFor(() => expect(result.current.userMemory).toBe(`${memory}\n喜欢草莓`));
    expect(await repository.getUserMemory()).toBe(`${memory}\n喜欢草莓`);
  });

  it("完整传递预算内的长原文，保留末尾对偏好的更正", async () => {
    const userText = `我喜欢草莓。${"今天想分享一些日常。".repeat(200)}更正一下，我现在更喜欢蓝莓。`;
    const streamChat = model('{"title":"水果偏好","memory":"喜欢蓝莓"}');
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send(userText));
    await waitFor(() => expect(result.current.userMemory).toBe("喜欢蓝莓"));
    const request = streamChat.mock.calls.find(([request]) => request.mode === "metadata")![0];
    expect(JSON.parse(request.messages[0]!.text)).toMatchObject({ updateMemory: true });
    expect(JSON.parse(request.messages[1]!.text)).toEqual({ userText });
  });

  it("用户原文超出包装后的预算时仅生成标题，不根据截断文字更新记忆", async () => {
    await repository.updateUserMemory("喜欢蓝莓");
    const userText = `我喜欢草莓。${"今天想分享一些日常。".repeat(500)}更正一下，我现在更喜欢蓝莓。`;
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send(userText));
    await waitFor(() => expect(result.current.activeConversation?.title).toBe("草莓与日常"));
    const request = streamChat.mock.calls.find(([request]) => request.mode === "metadata")![0];
    expect(JSON.parse(request.messages[0]!.text)).toMatchObject({ updateMemory: false, existingMemory: "" });
    expect(request.messages.every((message) => [...message.text].length <= 4000)).toBe(true);
    expect(await repository.getUserMemory()).toBe("喜欢蓝莓");
    expect(result.current.userMemory).toBe("喜欢蓝莓");
  });

  it("整理请求的 JSON 转义与多字节文本遵守单条及总量预算", async () => {
    const longText = '😀\u0000"\\'.repeat(700);
    const streamChat = vi.fn<StreamChatFunction>(async (request, options) => {
      options.onDelta(request.mode === "metadata" ? '{"title":"字符测试","memory":null}' : longText);
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send(longText));
    await waitFor(() => expect(result.current.activeConversation?.title).toBe("字符测试"));
    const request = streamChat.mock.calls.find(([request]) => request.mode === "metadata")![0];
    expect(JSON.parse(request.messages[0]!.text)).toMatchObject({ updateMemory: false });
    expect(request.messages.every((message) => [...message.text].length <= 4000)).toBe(true);
    expect(request.messages.reduce((length, message) => length + [...message.text].length, 0)).toBeLessThanOrEqual(24_000);
    const userData: { userText: string } = JSON.parse(request.messages[1]!.text);
    const assistantData: { assistantText: string } = JSON.parse(request.messages[2]!.text);
    expect(userData.userText.length).toBeGreaterThan(0);
    expect(assistantData.assistantText.length).toBeGreaterThan(0);
    expect(longText.startsWith(userData.userText)).toBe(true);
    expect(longText.startsWith(assistantData.assistantText)).toBe(true);
  });

  it("整理结果等待数据库事务时停止，不提交已取消的整理", async () => {
    const response = deferred();
    let metadataStarted = false;
    const streamChat = vi.fn<StreamChatFunction>(async (request, options) => {
      if (request.mode !== "metadata") options.onDelta("知道啦。");
      else {
        metadataStarted = true;
        await response.promise;
        options.onDelta('{"title":"草莓","memory":"喜欢草莓"}');
      }
      return { truncated: false };
    });
    const applyMetadata = vi.spyOn(repository, "applyConversationMetadata");
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.send("我喜欢草莓"));
    await waitFor(() => expect(metadataStarted).toBe(true));

    const releaseStorage = deferred();
    const storageLocked = deferred();
    const lock = db.transaction("rw", db.settings, async () => {
      storageLocked.resolve();
      await Dexie.waitFor(releaseStorage.promise);
    });
    await storageLocked.promise;
    try {
      await act(async () => { response.resolve(); });
      await waitFor(() => expect(applyMetadata).toHaveBeenCalledTimes(1));
      await act(() => result.current.stop());
    } finally {
      releaseStorage.resolve();
      await act(async () => {
        await lock;
        await applyMetadata.mock.results[0]?.value.catch(() => undefined);
      });
    }
    expect(await repository.getUserMemory()).toBe("");
    expect((await repository.getConversation(result.current.activeConversation!.id))?.title).toBe("新的对话");
    expect(result.current.errorCode).toBeUndefined();
  });
});
