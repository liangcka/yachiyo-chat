import Dexie, { type Transaction } from "dexie";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";
import {
  isUntitledConversation,
  validateConversationMetadata,
  type ConversationMetadata,
} from "../domain/conversation-metadata";
import {
  MAX_USER_MEMORY_HISTORY,
  composeUserMemory,
  parseUserMemorySources,
  parseUserMemoryHistory,
  withoutConversationMemory,
  type UserMemoryChangeContext,
  type UserMemoryRevision,
  type UserMemorySources,
} from "../domain/user-memory";
import type { YachiyoDatabase } from "./db";
import { searchConversations } from "./conversation-search";
import type { ConversationSearchResult } from "../domain/conversation-search";

const MAX_CONVERSATIONS = 30;

export class ConversationLimitError extends Error {
  constructor() {
    super(`Only ${MAX_CONVERSATIONS} local conversations are supported.`);
    this.name = "ConversationLimitError";
  }
}

function defaultTitle(locale: Locale): string {
  return locale === "ja-JP" ? "新しい会話" : "新的对话";
}

function requireTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new TypeError("Conversation title cannot be empty.");
  }
  return normalized;
}

export class ConversationRepository {
  constructor(private readonly db: YachiyoDatabase) {}

  /** 提交完成前持续监听取消信号，保证后台更新整体回滚。 */
  private async runCancellableWrite<T>(
    tableNames: readonly string[],
    signal: AbortSignal | undefined,
    write: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    let transaction: Transaction | undefined;
    const abort = () => transaction?.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await this.db.transaction("rw", tableNames, (current) => {
        transaction = current;
        signal?.throwIfAborted();
        return write();
      });
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async createConversation(locale: Locale, now = Date.now()): Promise<Conversation> {
    return this.db.transaction("rw", this.db.conversations, async () => {
      if ((await this.db.conversations.count()) >= MAX_CONVERSATIONS) {
        throw new ConversationLimitError();
      }

      const conversation: Conversation = {
        id: crypto.randomUUID(),
        title: defaultTitle(locale),
        locale,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.conversations.add(conversation);
      return conversation;
    });
  }

  listConversations(): Promise<Conversation[]> {
    return this.db.conversations.orderBy("updatedAt").reverse().toArray();
  }

  searchConversations(query: string): Promise<ConversationSearchResult[]> {
    return searchConversations(this.db, query);
  }

  getConversation(id: string): Promise<Conversation | undefined> {
    return this.db.conversations.get(id);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.db.conversations.update(id, { title: requireTitle(title), titleSource: "manual" });
  }

  async applyConversationMetadata(
    conversationId: string,
    messageId: string,
    expectedMemory: string,
    metadata: ConversationMetadata,
    signal?: AbortSignal,
  ): Promise<{ conversation?: Conversation; memory?: string }> {
    const validated = validateConversationMetadata(metadata);
    if (validated === undefined) return {};
    return this.runCancellableWrite(
      ["conversations", "messages", "settings"], signal, async () => {
        const conversation = await this.db.conversations.get(conversationId);
        const [latestMessage] = await this.listMessages(conversationId, { limit: 1 });
        if (
          conversation === undefined || latestMessage?.id !== messageId ||
          latestMessage.status !== "complete" || latestMessage.role !== "assistant"
        ) return {};

        const result: { conversation?: Conversation; memory?: string } = {};
        if (validated.title !== null && isUntitledConversation(conversation)) {
          const updated: Conversation = { ...conversation, title: validated.title, titleSource: "generated" };
          await this.db.conversations.update(conversationId, { title: updated.title, titleSource: updated.titleSource });
          result.conversation = updated;
        }
        // 后台请求只可替换它实际读取过的画像，用户编辑和其他会话的新结果优先。
        if (validated.memory !== null && await this.getUserMemory() === expectedMemory) {
          await this.updateUserMemory(validated.memory, { source: "automatic", conversationId, messageId });
          result.memory = await this.getUserMemory();
        }
        return result;
      },
    );
  }

  async touchConversation(id: string, now = Date.now()): Promise<void> {
    await this.db.conversations.update(id, { updatedAt: now });
  }

  async updateConversationSummary(
    id: string,
    summary: string,
    now = Date.now(),
    compressedUpTo?: number,
    compressedUpToId?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const patch: Partial<Conversation> = { summary, lastCompressedAt: now, updatedAt: now };
    if (compressedUpTo !== undefined) patch.compressedUpTo = compressedUpTo;
    if (compressedUpToId !== undefined) patch.compressedUpToId = compressedUpToId;
    await this.runCancellableWrite(["conversations"], signal, async () => {
      await this.db.conversations.update(id, patch);
    });
  }

  /** 读取跨会话共享的用户长期记忆（userMemory），无记录时返回空字符串 */
  async getUserMemory(): Promise<string> {
    const record = await this.db.settings.get("userMemory");
    return record !== undefined && record.key === "userMemory" && typeof record.value === "string"
      ? record.value
      : "";
  }

  async updateUserMemory(memory: string, context: UserMemoryChangeContext = { source: "manual" }): Promise<void> {
    await this.db.transaction("rw", this.db.settings, async () => {
      const sources = await this.getUserMemorySources();
      if ((context.source === "automatic" || context.source === "message") && context.conversationId !== undefined) {
        if ((sources.conversations.find((source) => source.conversationId === context.conversationId)?.memory ?? "") === memory) return;
        const next = withoutConversationMemory(sources, context.conversationId);
        if (memory) next.conversations.push({ conversationId: context.conversationId, memory });
        await this.saveUserMemorySources(next, context);
      } else {
        if (await this.getUserMemory() === memory) return;
        await this.saveUserMemorySources({ independent: memory, conversations: [] }, context);
      }
    });
  }

  private async getUserMemorySources(): Promise<UserMemorySources> {
    const memory = await this.getUserMemory();
    const record = await this.db.settings.get("userMemorySources");
    const sources = record?.key === "userMemorySources" ? parseUserMemorySources(record.value) : undefined;
    // 无来源的旧数据不能按文本猜测归属，否则删除会话可能误删其他事实。
    return sources !== undefined && composeUserMemory(sources) === memory
      ? sources : { independent: memory, conversations: [] };
  }

  async getConversationMemory(conversationId: string): Promise<string> {
    return (await this.getUserMemorySources()).conversations.find((source) => source.conversationId === conversationId)?.memory ?? "";
  }

  private async saveUserMemorySources(sources: UserMemorySources, context: UserMemoryChangeContext): Promise<void> {
    const before = await this.getUserMemory();
    const memorySourcesBefore = await this.getUserMemorySources();
    if (JSON.stringify(memorySourcesBefore) === JSON.stringify(sources)) return;
    const history = await this.listUserMemoryHistory();
    const after = composeUserMemory(sources);
    const revision: UserMemoryRevision = {
      id: crypto.randomUUID(), createdAt: Date.now(), before, after, ...context,
      memorySourcesBefore, memorySourcesAfter: sources,
    };
    await this.db.settings.put({ key: "userMemorySources", value: sources });
    await this.db.settings.put({ key: "userMemory", value: after });
    await this.db.settings.put({ key: "userMemoryHistory", value: [revision, ...history].slice(0, MAX_USER_MEMORY_HISTORY) });
  }

  async listUserMemoryHistory(): Promise<UserMemoryRevision[]> {
    const record = await this.db.settings.get("userMemoryHistory");
    return record?.key === "userMemoryHistory" ? parseUserMemoryHistory(record.value) : [];
  }

  /** 只撤销仍与当前记忆匹配的最新变更；过期记录不产生写入。 */
  async undoUserMemoryChange(revisionId: string): Promise<string | undefined> {
    return this.db.transaction("rw", this.db.settings, async () => {
      const [latest] = await this.listUserMemoryHistory();
      if (latest?.id !== revisionId || await this.getUserMemory() !== latest.after) return undefined;
      await this.saveUserMemorySources(latest.memorySourcesBefore ?? { independent: latest.before, conversations: [] }, {
        source: "undo",
        ...(latest.conversationId === undefined ? {} : { conversationId: latest.conversationId }),
        ...(latest.messageId === undefined ? {} : { messageId: latest.messageId }),
      });
      return latest.before;
    });
  }

  /** 消息仍有效且记忆未变化时，保存基于该消息整理的结果。 */
  async rememberMessageMemory(
    conversationId: string,
    messageId: string,
    expectedMemory: string,
    memory: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const validated = validateConversationMetadata({ title: null, memory });
    const nextMemory = validated?.memory;
    if (typeof nextMemory !== "string") return undefined;
    return this.runCancellableWrite(["conversations", "messages", "settings"], signal, async () => {
      const message = await this.db.messages.get(messageId);
      if (
        await this.db.conversations.get(conversationId) === undefined ||
        message?.conversationId !== conversationId || message.role !== "user" ||
        message.status !== "complete" || typeof message.text !== "string" || message.text.trim().length === 0 ||
        await this.getUserMemory() !== expectedMemory
      ) return undefined;
      await this.updateUserMemory(nextMemory, { source: "message", conversationId, messageId });
      return this.getUserMemory();
    });
  }

  /** 会话、来源记忆与历史快照原子删除，返回提交后的共享记忆。 */
  async deleteConversation(id: string): Promise<string> {
    return this.db.transaction(
      "rw",
      [this.db.conversations, this.db.messages, this.db.images, this.db.settings],
      async () => {
        const sourceRecord = await this.db.settings.get("userMemorySources");
        if (sourceRecord?.key !== "userMemorySources" || parseUserMemorySources(sourceRecord.value) === undefined) {
          // 旧版本只可利用连续且仍匹配的快照恢复，不能把混合全文归属给某个会话。
          await this.recallMessagesFrom(id, Dexie.minKey);
        }
        const sources = withoutConversationMemory(await this.getUserMemorySources(), id);
        const history = (await this.listUserMemoryHistory()).flatMap((revision) => {
          if (revision.conversationId === id) return [];
          if (revision.memorySourcesBefore === undefined || revision.memorySourcesAfter === undefined) return [revision];
          const before = withoutConversationMemory(revision.memorySourcesBefore, id);
          const after = withoutConversationMemory(revision.memorySourcesAfter, id);
          return [{ ...revision, before: composeUserMemory(before), after: composeUserMemory(after),
            memorySourcesBefore: before, memorySourcesAfter: after }];
        });
        await this.db.settings.put({ key: "userMemorySources", value: sources });
        await this.db.settings.put({ key: "userMemory", value: composeUserMemory(sources) });
        await this.db.settings.put({ key: "userMemoryHistory", value: history });
        await this.db.messages.where("conversationId").equals(id).delete();
        await this.db.images.where("conversationId").equals(id).delete();
        await this.db.conversations.delete(id);
        return composeUserMemory(sources);
      },
    );
  }

  /** 按时间升序读取会话消息；传入 beforeCreatedAt 时只返回该水位线之前的最近 limit 条（倒序索引扫描） */
  async listMessages(
    conversationId: string,
    options?: { beforeCreatedAt?: number; limit?: number },
  ): Promise<ChatMessage[]> {
    const before = options?.beforeCreatedAt;
    const collection = this.db.messages
      .where("[conversationId+createdAt]")
      .between(
        [conversationId, Dexie.minKey],
        [conversationId, before ?? Dexie.maxKey],
        true,
        before === undefined,
      );
    if (options?.limit === undefined) {
      return collection.toArray();
    }
    // 倒序扫描取最近 limit 条后翻回升序
    const page = await collection.reverse().limit(options.limit).toArray();
    return page.reverse();
  }

  /** 定点删除指定 createdAt 水位线之后的消息（含边界），用于撤回/重生成时避免全量重写 */
  async deleteMessagesFrom(conversationId: string, fromCreatedAt: number): Promise<void> {
    await this.db.transaction("rw", [this.db.conversations, this.db.messages], async () => {
      await this.db.messages
        .where("[conversationId+createdAt]")
        .between([conversationId, fromCreatedAt], [conversationId, Dexie.maxKey], true, true)
        .delete();
      const conversation = await this.db.conversations.get(conversationId);
      if (conversation?.compressedUpTo !== undefined && fromCreatedAt <= conversation.compressedUpTo) {
        await this.db.conversations.update(conversationId, {
          summary: undefined,
          compressedUpTo: undefined,
          compressedUpToId: undefined,
          lastCompressedAt: undefined,
        });
      }
    });
  }

  /** 撤回消息及其连续的记忆更新；消息删除与记忆恢复必须同时提交。 */
  async recallMessagesFrom(conversationId: string, fromCreatedAt: number): Promise<string> {
    return this.db.transaction("rw", [this.db.conversations, this.db.messages, this.db.settings], async () => {
      const removedIds = new Set(await this.db.messages
        .where("[conversationId+createdAt]")
        .between([conversationId, fromCreatedAt], [conversationId, Dexie.maxKey], true, true)
        .primaryKeys());
      const history = await this.listUserMemoryHistory();
      let memory = await this.getUserMemory();
      let sources = await this.getUserMemorySources();
      let reverted = 0;
      for (const revision of history) {
        // 全文快照不能跨过独立更新回滚，否则会覆盖其他消息或手动保存的记忆。
        if (
          revision.after !== memory || revision.conversationId !== conversationId ||
          revision.messageId === undefined || !removedIds.has(revision.messageId) ||
          (revision.source !== "automatic" && revision.source !== "message")
        ) break;
        memory = revision.before;
        sources = revision.memorySourcesBefore ?? { independent: memory, conversations: [] };
        reverted += 1;
      }
      await this.deleteMessagesFrom(conversationId, fromCreatedAt);
      if (reverted > 0) {
        await this.db.settings.put({ key: "userMemorySources", value: sources });
        await this.db.settings.put({ key: "userMemory", value: memory });
        await this.db.settings.put({ key: "userMemoryHistory", value: history.slice(reverted) });
      }
      return memory;
    });
  }

  async putMessage(message: ChatMessage): Promise<void> {
    await this.db.transaction("rw", [this.db.conversations, this.db.messages], async () => {
      const conversation = await this.db.conversations.get(message.conversationId);
      if (!conversation) {
        throw new Error("Cannot store a message for a missing conversation.");
      }

      await this.db.messages.put(message);
      if (message.createdAt > conversation.updatedAt) {
        await this.db.conversations.update(conversation.id, { updatedAt: message.createdAt });
      }
    });
  }

  /**
   * 将会话消息截断为给定前缀：只删除水位线之后的部分，不重写保留区。
   * 撤回/重生成的调用方保证 messages 是现有记录的前缀，且时间戳严格递增。
   */
  async replaceMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    await this.db.transaction("rw", [this.db.conversations, this.db.messages], async () => {
      const conversation = await this.db.conversations.get(conversationId);
      if (!conversation) {
        throw new Error("Cannot store a message for a missing conversation.");
      }
      const lastKept = messages[messages.length - 1];
      await this.db.messages
        .where("[conversationId+createdAt]")
        .between(
          [conversationId, lastKept === undefined ? Dexie.minKey : lastKept.createdAt],
          [conversationId, Dexie.maxKey],
          lastKept !== undefined,
          true,
        )
        .delete();
      if (messages.length > 0) {
        await this.db.messages.bulkPut(messages);
      }
    });
  }

  async putImage(image: StoredImage): Promise<void> {
    if (!(await this.db.conversations.get(image.conversationId))) {
      throw new Error("Cannot store an image for a missing conversation.");
    }
    await this.db.images.put(image);
  }

  getImage(id: string): Promise<StoredImage | undefined> {
    return this.db.images.get(id);
  }

  async setLocale(locale: Locale): Promise<void> {
    await this.db.settings.put({ key: "locale", value: locale });
  }

  async setConversationLocale(id: string, locale: Locale): Promise<void> {
    await this.db.transaction("rw", this.db.conversations, async () => {
      const conversation = await this.db.conversations.get(id);
      if (conversation === undefined) return;
      await this.db.conversations.update(id, {
        locale,
        ...(isUntitledConversation(conversation) ? { title: defaultTitle(locale) } : {}),
      });
    });
  }

  async getLocale(): Promise<Locale> {
    const record = await this.db.settings.get("locale");
    return record !== undefined && record.key === "locale" ? record.value : "zh-CN";
  }

  async getOnboardingCompleted(): Promise<boolean> {
    const record = await this.db.settings.get("onboardingCompleted");
    return record?.key === "onboardingCompleted" && record.value === true;
  }

  async setOnboardingCompleted(completed: boolean): Promise<void> {
    await this.db.settings.put({ key: "onboardingCompleted", value: completed });
  }

  async setMultiBubble(multiBubble: boolean): Promise<void> {
    await this.db.settings.put({ key: "multiBubble", value: multiBubble });
  }

  async getMultiBubble(): Promise<boolean> {
    const record = await this.db.settings.get("multiBubble");
    return record !== undefined && record.key === "multiBubble" && typeof record.value === "boolean"
      ? record.value
      : true;
  }

  async clearAll(): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.conversations, this.db.messages, this.db.images, this.db.settings],
      async () => {
        await Promise.all([
          this.db.conversations.clear(),
          this.db.messages.clear(),
          this.db.images.clear(),
          this.db.settings.clear(),
        ]);
      },
    );
  }
}
