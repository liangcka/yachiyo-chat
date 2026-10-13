import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    expect(await repository.getConversation(conversation.id)).toMatchObject({
      title: "夏夜",
      titleSource: "manual",
    });
  });

  it("updates conversation updatedAt timestamp via touchConversation", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);

    await repository.touchConversation(conversation.id, 99);

    expect(await repository.getConversation(conversation.id)).toMatchObject({ updatedAt: 99 });
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

  it("读取非法持久化记忆时返回空文本", async () => {
    await db.settings.put({ key: "userMemory", value: 42 as unknown as string });
    expect(await repository.getUserMemory()).toBe("");
  });

  describe("记忆变更历史", () => {
    it("仅记录真实变更，保留来源及前后文本，最近的变更在前", async () => {
      await repository.updateUserMemory("");
      expect(await repository.listUserMemoryHistory()).toEqual([]);

      await repository.updateUserMemory("喜欢绿茶");
      await repository.updateUserMemory("喜欢绿茶");
      await repository.updateUserMemory("喜欢咖啡", {
        source: "message", conversationId: "conversation", messageId: "message",
      });

      const history = await repository.listUserMemoryHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        before: "喜欢绿茶", after: "喜欢绿茶\n喜欢咖啡", source: "message",
        conversationId: "conversation", messageId: "message",
      });
      expect(history[1]).toMatchObject({ before: "", after: "喜欢绿茶", source: "manual" });
      expect(history[0]?.id).toEqual(expect.any(String));
      expect(history[0]?.createdAt).toEqual(expect.any(Number));
      expect(await new ConversationRepository(db).listUserMemoryHistory()).toEqual(history);
    });

    it("并发保存时保留连续的变更链，最多保存最近 30 项", async () => {
      await Promise.all(Array.from({ length: 32 }, (_, index) =>
        repository.updateUserMemory(`记忆 ${index}`),
      ));

      const history = await repository.listUserMemoryHistory();
      expect(history).toHaveLength(30);
      expect(await repository.getUserMemory()).toBe(history[0]?.after);
      for (let index = 0; index < history.length - 1; index += 1) {
        expect(history[index]?.before).toBe(history[index + 1]?.after);
      }
    });

    it("只撤销最新且仍匹配当前记忆的变更，并保留撤销记录", async () => {
      await repository.updateUserMemory("喜欢绿茶");
      await repository.updateUserMemory("喜欢咖啡");
      const [latest, older] = await repository.listUserMemoryHistory();
      expect(await repository.undoUserMemoryChange(older!.id)).toBeUndefined();
      expect(await repository.undoUserMemoryChange(latest!.id)).toBe("喜欢绿茶");
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
      expect((await repository.listUserMemoryHistory())[0]).toMatchObject({
        before: "喜欢咖啡", after: "喜欢绿茶", source: "undo",
      });
      expect(await repository.undoUserMemoryChange(latest!.id)).toBeUndefined();
    });

    it("当前记忆与记录不匹配时拒绝撤销，清空全部数据后不留下历史", async () => {
      await repository.updateUserMemory("喜欢绿茶");
      const [latest] = await repository.listUserMemoryHistory();
      await db.settings.put({ key: "userMemory", value: "外部更新" });
      expect(await repository.undoUserMemoryChange(latest!.id)).toBeUndefined();
      expect(await repository.getUserMemory()).toBe("外部更新");

      await repository.clearAll();
      await repository.updateUserMemory("");
      expect(await repository.listUserMemoryHistory()).toEqual([]);
    });

    it("历史写入失败时连同当前记忆一起回滚", async () => {
      await repository.updateUserMemory("喜欢绿茶");
      const originalHistory = await repository.listUserMemoryHistory();
      const originalPut = db.settings.put.bind(db.settings);
      const put = vi.spyOn(db.settings, "put").mockImplementation((setting) => {
        if (setting.key === "userMemoryHistory") throw new Error("历史保存失败");
        return originalPut(setting);
      });

      await expect(repository.updateUserMemory("喜欢咖啡")).rejects.toThrow("历史保存失败");
      put.mockRestore();
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
      expect(await repository.listUserMemoryHistory()).toEqual(originalHistory);
    });
  });

  describe("撤回消息与记忆", () => {
    async function rememberedTurn(): Promise<{ conversationId: string; userId: string; assistantId: string }> {
      const conversation = await repository.createConversation("zh-CN", 1);
      const userId = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      await repository.putMessage({ id: userId, conversationId: conversation.id, role: "user", text: "记住我喜欢草莓", status: "complete", createdAt: 2 });
      await repository.putMessage({ id: assistantId, conversationId: conversation.id, role: "assistant", text: "记住了", status: "complete", createdAt: 3 });
      await repository.updateUserMemory("喜欢绿茶");
      await repository.rememberMessageMemory(conversation.id, userId, "喜欢绿茶", "喜欢草莓");
      return { conversationId: conversation.id, userId, assistantId };
    }

    it("回滚同轮主动记住与自动整理的连续记录，保留早先记忆", async () => {
      const { conversationId, assistantId } = await rememberedTurn();
      await repository.applyConversationMetadata(conversationId, assistantId, "喜欢绿茶\n喜欢草莓", {
        title: null, memory: "喜欢草莓大福",
      });
      expect(await repository.recallMessagesFrom(conversationId, 2)).toBe("喜欢绿茶");
      expect(await repository.listMessages(conversationId)).toEqual([]);
      expect(await repository.listUserMemoryHistory()).toHaveLength(1);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
    });

    it("删除整个会话时恢复该会话的连续记忆更新，保留此前记忆", async () => {
      const { conversationId, assistantId } = await rememberedTurn();
      await repository.applyConversationMetadata(conversationId, assistantId, "喜欢绿茶\n喜欢草莓", {
        title: null, memory: "喜欢草莓大福",
      });

      await repository.deleteConversation(conversationId);

      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
      expect(await repository.listUserMemoryHistory()).toHaveLength(1);
      expect(await repository.getConversation(conversationId)).toBeUndefined();
      expect(await repository.listMessages(conversationId)).toEqual([]);
    });

    it("删除较早会话只清理该来源，其他来源及其撤销快照不包含已删事实", async () => {
      const { conversationId } = await rememberedTurn();
      const other = await repository.createConversation("zh-CN", 5);
      await repository.putMessage({ id: "other-user", conversationId: other.id, role: "user", text: "住在东京", status: "complete", createdAt: 6 });
      await repository.rememberMessageMemory(other.id, "other-user", "喜欢绿茶\n喜欢草莓", "住在东京");

      await repository.deleteConversation(conversationId);

      expect(await repository.getUserMemory()).toBe("喜欢绿茶\n住在东京");
      expect(await repository.getConversationMemory(other.id)).toBe("住在东京");
      const [latest] = await repository.listUserMemoryHistory();
      expect(JSON.stringify(await repository.listUserMemoryHistory())).not.toContain("草莓");
      await repository.undoUserMemoryChange(latest!.id);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
    });

    it("删除来源不受 30 条变更历史上限影响，重复事实保留仍有效的来源", async () => {
      const { conversationId } = await rememberedTurn();
      const other = await repository.createConversation("zh-CN", 5);
      await repository.putMessage({ id: "other-user", conversationId: other.id, role: "user", text: "也喜欢草莓", status: "complete", createdAt: 6 });
      for (let index = 0; index < 32; index += 1) {
        await repository.rememberMessageMemory(other.id, "other-user", await repository.getUserMemory(), `喜欢草莓\n住在东京 ${index}`);
      }
      await repository.deleteConversation(conversationId);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶\n喜欢草莓\n住在东京 31");
      await repository.deleteConversation(other.id);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
    });

    it("删除写入失败时原子保留会话、消息、来源与记忆", async () => {
      const { conversationId } = await rememberedTurn();
      const put = db.settings.put.bind(db.settings);
      vi.spyOn(db.settings, "put").mockImplementation((record) => {
        if (record.key === "userMemoryHistory") throw new Error("写入失败");
        return put(record);
      });
      await expect(repository.deleteConversation(conversationId)).rejects.toThrow("写入失败");
      expect(await repository.getConversation(conversationId)).toBeDefined();
      expect(await repository.listMessages(conversationId)).toHaveLength(2);
      expect(await repository.getConversationMemory(conversationId)).toBe("喜欢草莓");
      expect(await repository.getUserMemory()).toBe("喜欢绿茶\n喜欢草莓");
    });

    it("旧版无来源记忆仅安全回退连续快照，不猜测独立混合记忆的归属", async () => {
      const { conversationId, userId } = await rememberedTurn();
      await db.settings.delete("userMemorySources");
      await db.settings.put({ key: "userMemoryHistory", value: [{
        id: "legacy", createdAt: 10, before: "喜欢绿茶", after: "喜欢绿茶\n喜欢草莓",
        source: "message", conversationId, messageId: userId,
      }] });
      await repository.deleteConversation(conversationId);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
      const other = await repository.createConversation("zh-CN", 20);
      await db.settings.delete("userMemorySources");
      await db.settings.put({ key: "userMemory", value: "无来源的混合旧记忆" });
      await repository.deleteConversation(other.id);
      expect(await repository.getUserMemory()).toBe("无来源的混合旧记忆");
    });

    it("相同事实新增来源即使正文不变也保存归属，删除一个来源不会清空另一个", async () => {
      const first = await repository.createConversation("zh-CN", 1);
      const second = await repository.createConversation("zh-CN", 2);
      await repository.updateUserMemory("喜欢草莓", { source: "automatic", conversationId: first.id, messageId: "first" });
      await repository.updateUserMemory("喜欢草莓", { source: "automatic", conversationId: second.id, messageId: "second" });
      expect(await repository.listUserMemoryHistory()).toHaveLength(2);
      expect(await repository.deleteConversation(first.id)).toBe("喜欢草莓");
      expect(await new ConversationRepository(db).getConversationMemory(second.id)).toBe("喜欢草莓");
      expect(await repository.deleteConversation(second.id)).toBe("");
    });

    it("手动替换记忆后撤销恢复来源，随后删除会话仍能清理原事实", async () => {
      const { conversationId } = await rememberedTurn();
      await repository.updateUserMemory("手动记忆");
      const [latest] = await repository.listUserMemoryHistory();
      await repository.undoUserMemoryChange(latest!.id);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶\n喜欢草莓");
      await repository.deleteConversation(conversationId);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
    });

    it("撤回其他消息不回滚仍有效的记忆来源", async () => {
      const { conversationId } = await rememberedTurn();
      await repository.putMessage({ id: "later", conversationId, role: "user", text: "你好", status: "complete", createdAt: 4 });
      expect(await repository.recallMessagesFrom(conversationId, 4)).toBe("喜欢绿茶\n喜欢草莓");
      expect(await repository.listUserMemoryHistory()).toHaveLength(2);
    });

    it("不以旧快照覆盖独立更新或不匹配的当前记忆", async () => {
      const { conversationId } = await rememberedTurn();
      await repository.updateUserMemory("喜欢咖啡");
      expect(await repository.recallMessagesFrom(conversationId, 2)).toBe("喜欢咖啡");
      expect(await repository.getUserMemory()).toBe("喜欢咖啡");
    });

    it("记忆恢复失败时保留消息、记忆和摘要，避免部分撤回", async () => {
      const { conversationId } = await rememberedTurn();
      await repository.updateConversationSummary(conversationId, "喜好摘要", 4, 3);
      const history = await repository.listUserMemoryHistory();
      const put = db.settings.put.bind(db.settings);
      vi.spyOn(db.settings, "put").mockImplementation((record) => {
        if (record.key === "userMemoryHistory") throw new Error("写入失败");
        return put(record);
      });

      await expect(repository.recallMessagesFrom(conversationId, 2)).rejects.toThrow("写入失败");
      expect(await repository.listMessages(conversationId)).toHaveLength(2);
      expect(await repository.getUserMemory()).toBe("喜欢绿茶\n喜欢草莓");
      expect(await repository.listUserMemoryHistory()).toEqual(history);
      expect(await repository.getConversation(conversationId)).toMatchObject({ summary: "喜好摘要", compressedUpTo: 3 });
    });
  });

  describe("主动记住消息", () => {
    async function storedUserMessage(): Promise<ChatMessage> {
      const conversation = await repository.createConversation("zh-CN", 10);
      const message: ChatMessage = {
        id: crypto.randomUUID(), conversationId: conversation.id, role: "user",
        text: "我喜欢绿茶", status: "complete", createdAt: 20,
      };
      await repository.putMessage(message);
      await repository.putMessage({ ...message, id: "later", role: "assistant", text: "记住了", createdAt: 30 });
      return message;
    }

    it("允许从旧用户消息保存已整理的记忆，记录来源", async () => {
      const message = await storedUserMessage();
      expect(await repository.rememberMessageMemory(message.conversationId, message.id, "", " 喜欢绿茶 ")).toBe("喜欢绿茶");
      expect(await repository.getUserMemory()).toBe("喜欢绿茶");
      expect((await repository.listUserMemoryHistory())[0]).toMatchObject({
        before: "", after: "喜欢绿茶", source: "message",
        conversationId: message.conversationId, messageId: message.id,
      });
    });

    it.each(["消息已删除", "属于其他会话", "助手消息", "未完整消息", "空消息", "过期记忆", "超长输出"])(
      "%s 时不保存记忆或历史", async (scenario) => {
        const message = await storedUserMessage();
        if (scenario === "消息已删除") await db.messages.delete(message.id);
        if (scenario === "属于其他会话") await db.messages.update(message.id, { conversationId: "other" });
        if (scenario === "助手消息") await db.messages.update(message.id, { role: "assistant" });
        if (scenario === "未完整消息") await db.messages.update(message.id, { status: "stopped" });
        if (scenario === "空消息") await db.messages.update(message.id, { text: "  " });
        const expectedMemory = scenario === "过期记忆" ? "过期" : "";
        const memory = scenario === "超长输出" ? "茶".repeat(2001) : "喜欢绿茶";

        expect(await repository.rememberMessageMemory(message.conversationId, message.id, expectedMemory, memory)).toBeUndefined();
        expect(await repository.getUserMemory()).toBe("");
        expect(await repository.listUserMemoryHistory()).toEqual([]);
      },
    );

    it("提交前取消主动记忆时原子回滚记忆及历史", async () => {
      const message = await storedUserMessage();
      const controller = new AbortController();
      const originalUpdate = repository.updateUserMemory.bind(repository);
      const update = vi.spyOn(repository, "updateUserMemory").mockImplementationOnce(async (memory, context) => {
        await originalUpdate(memory, context);
        controller.abort();
      });

      await expect(repository.rememberMessageMemory(message.conversationId, message.id, "", "喜欢绿茶", controller.signal)).rejects.toThrow();
      update.mockRestore();
      expect(await repository.getUserMemory()).toBe("");
      expect(await repository.listUserMemoryHistory()).toEqual([]);
    });
  });

  describe("applyConversationMetadata", () => {
    async function completedConversation(): Promise<{ conversationId: string; message: ChatMessage }> {
      const conversation = await repository.createConversation("zh-CN", 10);
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        role: "assistant",
        text: "记得你喜欢草莓大福。",
        status: "complete",
        createdAt: 30,
      };
      await repository.putMessage(message);
      return { conversationId: conversation.id, message };
    }

    it("在末条完整回复仍存在时应用标题与记忆，保持会话排序时间", async () => {
      const { conversationId, message } = await completedConversation();
      await repository.updateUserMemory("喜欢甜点");

      const result = await repository.applyConversationMetadata(conversationId, message.id, "喜欢甜点", {
        title: "草莓大福与午后",
        memory: "喜欢甜点，尤其是草莓大福",
      });

      expect(result).toEqual({
        conversation: expect.objectContaining({ title: "草莓大福与午后", titleSource: "generated", updatedAt: 30 }),
        memory: "喜欢甜点\n喜欢甜点，尤其是草莓大福",
      });
      expect(await repository.getConversation(conversationId)).toEqual(result.conversation);
      expect(await repository.getUserMemory()).toBe(result.memory);
      expect((await repository.listUserMemoryHistory())[0]).toMatchObject({
        source: "automatic", conversationId, messageId: message.id,
        before: "喜欢甜点", after: "喜欢甜点\n喜欢甜点，尤其是草莓大福",
      });
    });

    it("手动改名为默认标题后也不会被后台结果覆盖", async () => {
      const { conversationId, message } = await completedConversation();
      await repository.renameConversation(conversationId, "新的对话");

      const result = await repository.applyConversationMetadata(conversationId, message.id, "", {
        title: "自动标题",
        memory: "喜欢草莓大福",
      });

      expect(result).toEqual({ memory: "喜欢草莓大福" });
      expect(await repository.getConversation(conversationId)).toMatchObject({ title: "新的对话", titleSource: "manual" });
    });

    it("提交前取消时同时回滚已写入事务的标题和记忆", async () => {
      const { conversationId, message } = await completedConversation();
      await repository.updateUserMemory("既有记忆");
      const originalHistory = await repository.listUserMemoryHistory();
      const controller = new AbortController();
      const originalUpdateMemory = repository.updateUserMemory.bind(repository);
      const updateMemory = vi.spyOn(repository, "updateUserMemory").mockImplementationOnce(async (memory, context) => {
        await originalUpdateMemory(memory, context);
        controller.abort();
      });
      await expect(repository.applyConversationMetadata(conversationId, message.id, "既有记忆", {
        title: "自动标题", memory: "自动记忆",
      }, controller.signal)).rejects.toThrow();
      updateMemory.mockRestore();

      expect(await repository.getUserMemory()).toBe("既有记忆");
      expect((await repository.getConversation(conversationId))?.title).toBe("新的对话");
      expect(await repository.listUserMemoryHistory()).toEqual(originalHistory);
    });

    it("保留既有自定义标题与已生成标题", async () => {
      const { conversationId, message } = await completedConversation();
      await db.conversations.update(conversationId, { title: "旧会话标题" });
      expect(await repository.applyConversationMetadata(conversationId, message.id, "", {
        title: "新自动标题", memory: null,
      })).toEqual({});

      await db.conversations.update(conversationId, { title: "新的对话", titleSource: "generated" });
      expect(await repository.applyConversationMetadata(conversationId, message.id, "", {
        title: "新自动标题", memory: null,
      })).toEqual({});
    });

    it("记忆已被用户编辑时拒绝旧画像但仍可生成标题", async () => {
      const { conversationId, message } = await completedConversation();
      await repository.updateUserMemory("用户刚编辑的记忆");

      const result = await repository.applyConversationMetadata(conversationId, message.id, "旧画像", {
        title: "午后聊天", memory: "过时的自动画像",
      });

      expect(result.conversation?.title).toBe("午后聊天");
      expect(result.memory).toBeUndefined();
      expect(await repository.getUserMemory()).toBe("用户刚编辑的记忆");
    });

    it("null 不改写，空记忆只清空当前来源，非法结果整体丢弃", async () => {
      const { conversationId, message } = await completedConversation();
      await repository.updateUserMemory("既有记忆");
      await repository.applyConversationMetadata(conversationId, message.id, "既有记忆", { title: null, memory: "当前会话事实" });
      expect(await repository.applyConversationMetadata(conversationId, message.id, "既有记忆\n当前会话事实", {
        title: null, memory: null,
      })).toEqual({});
      expect(await repository.applyConversationMetadata(conversationId, message.id, "既有记忆\n当前会话事实", {
        title: "超长".repeat(20), memory: "不应写入",
      })).toEqual({});
      expect(await repository.getUserMemory()).toBe("既有记忆\n当前会话事实");
      expect(await repository.applyConversationMetadata(conversationId, message.id, "既有记忆\n当前会话事实", {
        title: null, memory: "",
      })).toEqual({ memory: "既有记忆" });
      expect(await repository.getUserMemory()).toBe("既有记忆");
    });

    it.each(["会话已删除", "回复已撤回", "已有后续消息", "回复已停止", "消息来自用户", "消息属于其他会话"])(
      "%s 时忽略后台结果", async (scenario) => {
        const { conversationId, message } = await completedConversation();
        if (scenario === "会话已删除") await repository.deleteConversation(conversationId);
        if (scenario === "回复已撤回") await repository.deleteMessagesFrom(conversationId, message.createdAt);
        if (scenario === "已有后续消息") await repository.putMessage({ ...message, id: "next", role: "user", createdAt: 40 });
        if (scenario === "回复已停止") await repository.putMessage({ ...message, status: "stopped" });
        if (scenario === "消息来自用户") await repository.putMessage({ ...message, role: "user" });
        if (scenario === "消息属于其他会话") {
          const other = await repository.createConversation("zh-CN", 40);
          await repository.putMessage({ ...message, conversationId: other.id });
        }

        expect(await repository.applyConversationMetadata(conversationId, message.id, "", {
          title: "过期标题", memory: "过期记忆",
        })).toEqual({});
        expect(await repository.getUserMemory()).toBe("");
        expect((await repository.getConversation(conversationId))?.title).not.toBe("过期标题");
      },
    );
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

  it("新手引导状态缺失时视为尚未完成", async () => {
    expect(await repository.getOnboardingCompleted()).toBe(false);
  });

  it("持久化新手引导的完成与重置状态", async () => {
    await repository.setOnboardingCompleted(true);
    expect(await new ConversationRepository(db).getOnboardingCompleted()).toBe(true);

    await repository.setOnboardingCompleted(false);
    expect(await new ConversationRepository(db).getOnboardingCompleted()).toBe(false);
  });

  it.each([
    { value: "true" },
    { value: 1 },
    { value: null },
    { value: undefined },
    { value: {} },
  ])("新手引导的非法持久化值 $value 视为尚未完成", async ({ value }) => {
    await db.settings.put({ key: "onboardingCompleted", value: value as unknown as boolean });

    expect(await repository.getOnboardingCompleted()).toBe(false);
  });

  it("records a locale change on the active conversation", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);

    await repository.setConversationLocale(conversation.id, "ja-JP");

    expect(await repository.getConversation(conversation.id)).toMatchObject({ locale: "ja-JP" });
  });

  it("本地化未命名会话的默认标题，保留手动与 AI 标题", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    await repository.setConversationLocale(conversation.id, "ja-JP");
    expect(await repository.getConversation(conversation.id)).toMatchObject({ title: "新しい会話" });
    expect((await repository.getConversation(conversation.id))?.titleSource).toBeUndefined();

    await repository.renameConversation(conversation.id, "新的对话");
    await repository.setConversationLocale(conversation.id, "zh-CN");
    expect(await repository.getConversation(conversation.id)).toMatchObject({ title: "新的对话", titleSource: "manual" });
    await db.conversations.update(conversation.id, { title: "夏夜", titleSource: "generated" });
    await repository.setConversationLocale(conversation.id, "ja-JP");
    expect(await repository.getConversation(conversation.id)).toMatchObject({ title: "夏夜", titleSource: "generated" });
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
    await repository.setOnboardingCompleted(true);

    await repository.clearAll();

    expect(await repository.listConversations()).toEqual([]);
    expect(await repository.listMessages(conversation.id)).toEqual([]);
    expect(await repository.getLocale()).toBe("zh-CN");
    expect(await repository.getOnboardingCompleted()).toBe(false);
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

  it("撤回到压缩边界时让摘要及其水位线一起失效", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    await repository.updateConversationSummary(conversation.id, "包含被撤回内容的摘要", 100, 30, "compressed");
    await repository.deleteMessagesFrom(conversation.id, 30);

    const updated = await repository.getConversation(conversation.id);
    expect(updated?.summary).toBeUndefined();
    expect(updated?.compressedUpTo).toBeUndefined();
    expect(updated?.compressedUpToId).toBeUndefined();
    expect(updated?.lastCompressedAt).toBeUndefined();
    expect(updated?.updatedAt).toBe(100);
  });

  it("撤回仅涉及未压缩消息时保留既有摘要", async () => {
    const conversation = await repository.createConversation("zh-CN", 10);
    await repository.updateConversationSummary(conversation.id, "仍有效的摘要", 100, 30, "compressed");
    await repository.deleteMessagesFrom(conversation.id, 31);

    expect(await repository.getConversation(conversation.id)).toMatchObject({
      summary: "仍有效的摘要", compressedUpTo: 30, compressedUpToId: "compressed", lastCompressedAt: 100,
    });
  });
});
