import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, StoredImage } from "../domain/chat";
import { ConversationLimitError, ConversationRepository } from "./conversation-repository";
import { YachiyoDatabase } from "./db";

describe("ConversationRepository", () => {
  let db: YachiyoDatabase;
  let repository: ConversationRepository;

  beforeEach(() => {
    db = new YachiyoDatabase(`yachiyo-test-${crypto.randomUUID()}`);
    repository = new ConversationRepository(db);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("persists and orders conversations by latest activity", async () => {
    const older = await repository.createConversation("zh-CN", 10);
    const newer = await repository.createConversation("ja-JP", 20);

    expect((await repository.listConversations()).map(({ id }) => id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(await repository.getConversation(older.id)).toEqual(older);
  });

  it("renames conversations after trimming the title", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);

    await repository.renameConversation(conversation.id, "  夏夜  ");

    expect(await repository.getConversation(conversation.id)).toMatchObject({ title: "夏夜" });
  });

  it("updates conversation summary and timestamp", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);

    await repository.updateConversationSummary(conversation.id, "用户喜欢喝咖啡", 25);

    expect(await repository.getConversation(conversation.id)).toMatchObject({
      summary: "用户喜欢喝咖啡",
      lastCompressedAt: 25,
      updatedAt: 25,
    });
  });

  it("advances the compression boundary when updating a summary", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);

    await repository.updateConversationSummary(conversation.id, "第一段记忆", 25, 40);
    expect(await repository.getConversation(conversation.id)).toMatchObject({
      compressedUpTo: 40,
    });

    // 未提供边界时不改写既有边界
    await repository.updateConversationSummary(conversation.id, "第二段记忆", 26);
    expect(await repository.getConversation(conversation.id)).toMatchObject({
      compressedUpTo: 40,
      summary: "第二段记忆",
    });
  });

  it("persists and clears the cross-conversation user memory", async () => {
    expect(await repository.getUserMemory()).toBe("");

    await repository.updateUserMemory("彩叶喜欢草莓大福");
    expect(await repository.getUserMemory()).toBe("彩叶喜欢草莓大福");

    // 跨会话共享：与具体 conversation 无关
    const conversation = await repository.createConversation("zh-CN", 10);
    expect(conversation.id).toBeDefined();
    expect(await repository.getUserMemory()).toBe("彩叶喜欢草莓大福");

    await repository.clearAll();
    expect(await repository.getUserMemory()).toBe("");
  });

  it("stores messages in chronological order and updates conversation activity", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    const later: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      text: "好~",
      status: "complete",
      createdAt: 40,
    };
    const earlier: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      text: "八千代？",
      status: "complete",
      createdAt: 30,
    };

    await repository.putMessage(later);
    await repository.putMessage(earlier);

    expect((await repository.listMessages(conversation.id)).map(({ id }) => id)).toEqual([
      earlier.id,
      later.id,
    ]);
    expect(await repository.getConversation(conversation.id)).toMatchObject({ updatedAt: 40 });
  });

  it("stores images and deletes all conversation-owned records atomically", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    const image: StoredImage = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      blob: new Blob(["image"], { type: "image/jpeg" }),
      width: 320,
      height: 240,
      mimeType: "image/jpeg",
    };
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      text: "看到了什么？",
      imageId: image.id,
      status: "complete",
      createdAt: 20,
    };
    await repository.putImage(image);
    await repository.putMessage(message);

    expect(await repository.getImage(image.id)).toMatchObject({ id: image.id, width: 320 });

    await repository.deleteConversation(conversation.id);

    expect(await repository.getConversation(conversation.id)).toBeUndefined();
    expect(await repository.listMessages(conversation.id)).toEqual([]);
    expect(await repository.getImage(image.id)).toBeUndefined();
  });

  it("persists locale and defaults to Simplified Chinese", async () => {
    expect(await repository.getLocale()).toBe("zh-CN");

    await repository.setLocale("ja-JP");

    expect(await repository.getLocale()).toBe("ja-JP");
  });

  it("records a locale change on the active conversation", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);

    await repository.setConversationLocale(conversation.id, "ja-JP");

    expect(await repository.getConversation(conversation.id)).toMatchObject({ locale: "ja-JP" });
  });

  it("clears all local application data", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    await repository.putMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      text: "你好",
      status: "complete",
      createdAt: 20,
    });
    await repository.setLocale("ja-JP");

    await repository.clearAll();

    expect(await repository.listConversations()).toEqual([]);
    expect(await repository.listMessages(conversation.id)).toEqual([]);
    expect(await repository.getLocale()).toBe("zh-CN");
  });

  it("rejects a thirty-first conversation without deleting existing history", async () => {
    for (let index = 0; index < 30; index += 1) {
      await repository.createConversation("zh-CN", index);
    }

    await expect(repository.createConversation("zh-CN", 31)).rejects.toBeInstanceOf(
      ConversationLimitError,
    );
    expect(await repository.listConversations()).toHaveLength(30);
  });

  it("keeps the conversation limit under concurrent creation", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 31 }, (_, index) =>
        repository.createConversation("zh-CN", index),
      ),
    );

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(30);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(await repository.listConversations()).toHaveLength(30);
  });

  it("pages messages backwards from an exclusive createdAt watermark", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    for (let index = 1; index <= 5; index += 1) {
      await repository.putMessage({
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        role: index % 2 === 1 ? "user" : "assistant",
        text: `消息${index}`,
        status: "complete",
        createdAt: index * 10,
      });
    }

    const page = await repository.listMessages(conversation.id, { beforeCreatedAt: 40, limit: 2 });
    expect(page.map(({ text }) => text)).toEqual(["消息2", "消息3"]);

    // 水位线严格排除边界值本身
    const boundary = await repository.listMessages(conversation.id, { beforeCreatedAt: 30, limit: 10 });
    expect(boundary.map(({ text }) => text)).toEqual(["消息1", "消息2"]);

    // 不带分页参数时保持全量升序
    expect((await repository.listMessages(conversation.id)).map(({ text }) => text)).toEqual([
      "消息1",
      "消息2",
      "消息3",
      "消息4",
      "消息5",
    ]);
  });

  it("deletes messages from a watermark onward without touching earlier records", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    const kept: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      text: "保留",
      status: "complete",
      createdAt: 20,
    };
    const dropped: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      text: "删除一",
      status: "complete",
      createdAt: 30,
    };
    const otherConversation = await repository.createConversation("zh-CN", 11);
    const untouched: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: otherConversation.id,
      role: "user",
      text: "别的会话",
      status: "complete",
      createdAt: 35,
    };
    await repository.putMessage(kept);
    await repository.putMessage(dropped);
    await repository.putMessage(untouched);

    await repository.deleteMessagesFrom(conversation.id, 25);

    expect((await repository.listMessages(conversation.id)).map(({ id }) => id)).toEqual([kept.id]);
    expect((await repository.listMessages(otherConversation.id)).map(({ id }) => id)).toEqual([
      untouched.id,
    ]);
  });
});
