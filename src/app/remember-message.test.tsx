import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRepository } from "../data/conversation-repository";
import { YachiyoDatabase } from "../data/db";
import { useChatController, type StreamChatFunction } from "./use-chat-controller";

describe("主动记住消息与记忆撤销", () => {
  let db: YachiyoDatabase;
  let repository: ConversationRepository;
  let conversationId: string;

  beforeEach(async () => {
    db = new YachiyoDatabase(`remember-${crypto.randomUUID()}`);
    repository = new ConversationRepository(db);
    const conversation = await repository.createConversation("zh-CN", 1);
    conversationId = conversation.id;
    await repository.putMessage({ id: "selected", conversationId, role: "user", text: "我喜欢草莓", status: "complete", createdAt: 2 });
    await repository.putMessage({ id: "reply", conversationId, role: "assistant", text: "我猜你喜欢苹果", status: "complete", createdAt: 3 });
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  function model(memory: string | null = "喜欢草莓") {
    return vi.fn<StreamChatFunction>(async (_request, options) => {
      options.onDelta(JSON.stringify({ title: "模型不应改名", memory }));
      return { truncated: false };
    });
  }

  it("按选择的用户原文整理记忆，不使用助手猜测或修改标题", async () => {
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat, webSearchEnabled: true }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.rememberMessage("selected"); });
    expect(outcome).toBe("saved");
    expect(result.current.userMemory).toBe("喜欢草莓");
    expect(result.current.activeConversation?.title).toBe("新的对话");
    const request = streamChat.mock.calls[0]![0];
    expect(request.mode).toBe("metadata");
    expect(request.webSearch).toBeUndefined();
    expect(JSON.parse(request.messages[0]!.text)).toEqual({ generateTitle: false, updateMemory: true, existingMemory: "" });
    expect(JSON.parse(request.messages[1]!.text)).toEqual({ userText: "我喜欢草莓" });
    expect(JSON.parse(request.messages[2]!.text)).toEqual({ assistantText: "" });
    await waitFor(() => expect(result.current.userMemoryHistory[0]).toMatchObject({ source: "message", messageId: "selected" }));
  });

  it("助手或不存在的消息不能作为用户事实保存", async () => {
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => {
      expect(await result.current.rememberMessage("reply")).toBe("failed");
      expect(await result.current.rememberMessage("missing")).toBe("failed");
    });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it.each(["automatic", "message"] as const)("撤回消息时回滚已经保存的 %s 记忆，保留此前记忆", async (source) => {
    await repository.updateUserMemory("喜欢绿茶");
    if (source === "automatic") {
      await repository.applyConversationMetadata(conversationId, "reply", "喜欢绿茶", {
        title: null, memory: "喜欢绿茶\n喜欢草莓",
      });
    } else {
      await repository.rememberMessageMemory(conversationId, "selected", "喜欢绿茶", "喜欢绿茶\n喜欢草莓");
    }
    const { result } = renderHook(() => useChatController({ repository, streamChat: model() }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.userMemory).toBe("喜欢绿茶\n喜欢草莓");

    await act(async () => { expect((await result.current.recall())?.text).toBe("我喜欢草莓"); });

    expect(result.current.messages).toEqual([]);
    expect(result.current.userMemory).toBe("喜欢绿茶");
    expect(await new ConversationRepository(db).getUserMemory()).toBe("喜欢绿茶");
    await waitFor(() => expect(result.current.userMemoryHistory).toHaveLength(1));
  });

  it("撤回会取消仍在整理的记忆，迟到结果不重新保存", async () => {
    let resolve = () => {};
    let signal: AbortSignal | undefined;
    const pending = new Promise<void>((done) => { resolve = done; });
    const streamChat = vi.fn<StreamChatFunction>(async (_request, options) => {
      signal = options.signal;
      await pending;
      options.onDelta('{"title":null,"memory":"喜欢草莓"}');
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let remembering: Promise<string> | undefined;
    act(() => { remembering = result.current.rememberMessage("selected"); });
    await waitFor(() => expect(signal).toBeDefined());

    await act(() => result.current.recall());
    expect(signal!.aborted).toBe(true);
    await act(async () => { resolve(); expect(await remembering).toBe("cancelled"); });

    expect(await repository.getUserMemory()).toBe("");
    expect(await repository.listUserMemoryHistory()).toEqual([]);
  });

  it("记忆已提交但请求尚未返回时撤回，不留下记忆也不被迟到回调覆盖", async () => {
    let resolve = () => {};
    const pending = new Promise<void>((done) => { resolve = done; });
    const save = repository.rememberMessageMemory.bind(repository);
    vi.spyOn(repository, "rememberMessageMemory").mockImplementation(async (...args) => {
      const memory = await save(...args);
      await pending;
      return memory;
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat: model() }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let remembering: Promise<string> | undefined;
    act(() => { remembering = result.current.rememberMessage("selected"); });
    await waitFor(async () => expect(await repository.getUserMemory()).toBe("喜欢草莓"));

    await act(() => result.current.recall());
    await act(async () => { resolve(); expect(await remembering).toBe("cancelled"); });

    expect(result.current.userMemory).toBe("");
    expect(await repository.getUserMemory()).toBe("");
    expect(await repository.listUserMemoryHistory()).toEqual([]);
  });

  it("连续撤回逐轮恢复记忆，后续聊天不再注入已撤回的事实", async () => {
    await repository.rememberMessageMemory(conversationId, "selected", "", "喜欢草莓");
    await repository.putMessage({ id: "second", conversationId, role: "user", text: "住在东京", status: "complete", createdAt: 4 });
    await repository.rememberMessageMemory(conversationId, "second", "喜欢草莓", "喜欢草莓\n住在东京");
    const streamChat = model(null);
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(() => result.current.recall());
    expect(result.current.userMemory).toBe("喜欢草莓");
    await act(() => result.current.recall());
    expect(result.current.userMemory).toBe("");
    expect(await repository.getUserMemory()).toBe("");

    await act(() => result.current.send("你好"));
    const request = streamChat.mock.calls.find(([item]) => item.mode !== "metadata")![0];
    expect(request.messages.some(({ text }) => text.includes("喜欢草莓") || text.includes("住在东京"))).toBe(false);
  });

  it.each([null, ""])("没有新增事实时保留原记忆且不生成记录（%s）", async (memory) => {
    const { result } = renderHook(() => useChatController({ repository, streamChat: model(memory) }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => { expect(await result.current.rememberMessage("selected")).toBe("unchanged"); });
    expect(await repository.getUserMemory()).toBe("");
    expect(await repository.listUserMemoryHistory()).toEqual([]);
  });

  it("手动编辑取消主动记住，迟到的模型结果不覆盖编辑", async () => {
    let resolve = () => {};
    let signal: AbortSignal | undefined;
    const pending = new Promise<void>((done) => { resolve = done; });
    const streamChat = vi.fn<StreamChatFunction>(async (_request, options) => {
      signal = options.signal;
      await pending;
      options.onDelta('{"title":null,"memory":"喜欢草莓"}');
      return { truncated: false };
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let remembering: Promise<string> | undefined;
    act(() => { remembering = result.current.rememberMessage("selected"); });
    await waitFor(() => expect(signal).toBeDefined());
    await act(() => result.current.updateUserMemory("喜欢绿茶"));
    expect(signal!.aborted).toBe(true);
    await act(async () => { resolve(); expect(await remembering).toBe("cancelled"); });
    expect(await repository.getUserMemory()).toBe("喜欢绿茶");
  });

  it("撤销最近变更后同步正文和历史，旧记录无法再次撤销", async () => {
    const { result } = renderHook(() => useChatController({ repository, streamChat: model() }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.updateUserMemory("喜欢绿茶"));
    await act(() => result.current.updateUserMemory("喜欢咖啡"));
    await waitFor(() => expect(result.current.userMemoryHistory).toHaveLength(2));
    const latestId = result.current.userMemoryHistory[0]!.id;
    await act(async () => { expect(await result.current.undoUserMemoryChange(latestId)).toBe(true); });
    expect(result.current.userMemory).toBe("喜欢绿茶");
    expect(result.current.userMemoryHistory[0]?.source).toBe("undo");
    await act(async () => { expect(await result.current.undoUserMemoryChange(latestId)).toBe(false); });
    expect(await repository.getUserMemory()).toBe("喜欢绿茶");
  });

  it("完整原文超出预算时不发送截断事实", async () => {
    await repository.putMessage({ id: "long", conversationId, role: "user", text: "草".repeat(4100), status: "complete", createdAt: 4 });
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => { expect(await result.current.rememberMessage("long")).toBe("too-long"); });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("删除非当前会话后立即刷新共享记忆，下一轮不再注入已删来源", async () => {
    await repository.rememberMessageMemory(conversationId, "selected", "", "喜欢草莓");
    const other = await repository.createConversation("zh-CN", 4);
    await repository.putMessage({ id: "other", conversationId: other.id, role: "user", text: "住在东京", status: "complete", createdAt: 5 });
    await repository.rememberMessageMemory(other.id, "other", "喜欢草莓", "住在东京");
    const streamChat = model(null);
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.activeConversation?.id).toBe(other.id);

    await act(async () => { expect(await result.current.deleteConversation(conversationId)).toBe(true); });

    expect(result.current.activeConversation?.id).toBe(other.id);
    expect(result.current.userMemory).toBe("住在东京");
    expect(JSON.stringify(result.current.userMemoryHistory)).not.toContain("草莓");
    await act(() => result.current.send("还记得什么"));
    const request = streamChat.mock.calls.find(([item]) => item.mode !== "metadata")![0];
    expect(request.messages.some(({ text }) => text.includes("草莓"))).toBe(false);
    expect(request.messages.some(({ text }) => text.includes("住在东京"))).toBe(true);
  });

  it("主动记住只整理当前来源，不将其他会话事实复制到当前会话", async () => {
    const other = await repository.createConversation("zh-CN", 0);
    await repository.updateUserMemory("喜欢绿茶", { source: "message", conversationId: other.id, messageId: "older" });
    const streamChat = model();
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(() => result.current.rememberMessage("selected"));
    expect(JSON.parse(streamChat.mock.calls[0]![0].messages[0]!.text)).toMatchObject({ existingMemory: "" });
    expect(result.current.userMemory).toBe("喜欢绿茶\n喜欢草莓");
    await act(() => result.current.deleteConversation(other.id));
    expect(result.current.userMemory).toBe("喜欢草莓");
  });

  it("记忆提交后删除当前会话，迟到返回不恢复记忆", async () => {
    let resolve = () => {};
    const pending = new Promise<void>((done) => { resolve = done; });
    const save = repository.rememberMessageMemory.bind(repository);
    vi.spyOn(repository, "rememberMessageMemory").mockImplementation(async (...args) => {
      const memory = await save(...args);
      await pending;
      return memory;
    });
    const { result } = renderHook(() => useChatController({ repository, streamChat: model() }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let remembering: Promise<string> | undefined;
    act(() => { remembering = result.current.rememberMessage("selected"); });
    await waitFor(async () => expect(await repository.getUserMemory()).toBe("喜欢草莓"));
    await act(() => result.current.deleteConversation(conversationId));
    await act(async () => { resolve(); expect(await remembering).toBe("cancelled"); });
    expect(result.current.userMemory).toBe("");
    expect(await repository.getConversationMemory(conversationId)).toBe("");
    expect(await repository.listUserMemoryHistory()).toEqual([]);
  });

  it("删除失败保留界面记忆并报告存储错误", async () => {
    await repository.rememberMessageMemory(conversationId, "selected", "", "喜欢草莓");
    const { result } = renderHook(() => useChatController({ repository, streamChat: model() }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    vi.spyOn(repository, "deleteConversation").mockRejectedValueOnce(new Error("写入失败"));
    await act(async () => { expect(await result.current.deleteConversation(conversationId)).toBe(false); });
    expect(result.current.userMemory).toBe("喜欢草莓");
    expect(result.current.errorCode).toBe("STORAGE_ERROR");
  });
});
