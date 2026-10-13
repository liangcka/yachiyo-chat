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

describe("会话摘要的取消与持久化", () => {
  let db: YachiyoDatabase;
  let repository: ConversationRepository;

  beforeEach(() => {
    db = new YachiyoDatabase(`summary-lifecycle-${crypto.randomUUID()}`);
    repository = new ConversationRepository(db);
  });

  afterEach(async () => {
    cleanup();
    db.close();
    await db.delete();
  });

  it("摘要等待数据库事务时停止，不提交摘要及压缩水位线", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    for (let index = 0; index < 4; index += 1) {
      await repository.putMessage({
        conversationId: conversation.id,
        id: `message-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        status: "complete",
        text: `第${index + 1}条消息`,
        createdAt: 20 + index * 10,
      });
    }
    const response = deferred();
    const summaryStarted = deferred();
    const streamChat = vi.fn<StreamChatFunction>(async (_request, options) => {
      summaryStarted.resolve();
      await response.promise;
      options.onDelta("<conversation_memory>第一轮的摘要</conversation_memory>");
      return { truncated: false };
    });
    const updateSummary = vi.spyOn(repository, "updateConversationSummary");
    const { result } = renderHook(() => useChatController({ repository, streamChat }));
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let compressing: Promise<boolean> | undefined;
    act(() => { compressing = result.current.compressConversation(true); });
    await summaryStarted.promise;

    const releaseStorage = deferred();
    const storageLocked = deferred();
    const lock = db.transaction("rw", db.conversations, async () => {
      storageLocked.resolve();
      await Dexie.waitFor(releaseStorage.promise);
    });
    await storageLocked.promise;
    try {
      await act(async () => { response.resolve(); });
      await waitFor(() => expect(updateSummary).toHaveBeenCalledTimes(1));
      await act(() => result.current.stop());
    } finally {
      releaseStorage.resolve();
      await act(async () => {
        await lock;
        expect(await compressing).toBe(false);
      });
    }

    const stored = await repository.getConversation(conversation.id);
    expect(stored?.summary).toBeUndefined();
    expect(stored?.compressedUpTo).toBeUndefined();
    expect(stored?.compressedUpToId).toBeUndefined();
    expect(result.current.activeConversation?.summary).toBeUndefined();
    expect(result.current.errorCode).toBeUndefined();
  });
});
