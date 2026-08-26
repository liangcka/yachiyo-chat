import Dexie from "dexie";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";
import type { YachiyoDatabase } from "./db";

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

  getConversation(id: string): Promise<Conversation | undefined> {
    return this.db.conversations.get(id);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.db.conversations.update(id, { title: requireTitle(title) });
  }

  async updateConversationSummary(
    id: string,
    summary: string,
    now = Date.now(),
    compressedUpTo?: number,
    compressedUpToId?: string,
  ): Promise<void> {
    const patch: Partial<Conversation> = { summary, lastCompressedAt: now, updatedAt: now };
    if (compressedUpTo !== undefined) patch.compressedUpTo = compressedUpTo;
    if (compressedUpToId !== undefined) patch.compressedUpToId = compressedUpToId;
    await this.db.conversations.update(id, patch);
  }

  /** 读取跨会话共享的用户长期记忆（userMemory），无记录时返回空字符串 */
  async getUserMemory(): Promise<string> {
    const record = await this.db.settings.get("userMemory");
    return record !== undefined && record.key === "userMemory" ? record.value : "";
  }

  async updateUserMemory(memory: string): Promise<void> {
    await this.db.settings.put({ key: "userMemory", value: memory });
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.conversations, this.db.messages, this.db.images],
      async () => {
        await this.db.messages.where("conversationId").equals(id).delete();
        await this.db.images.where("conversationId").equals(id).delete();
        await this.db.conversations.delete(id);
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
    await this.db.messages
      .where("[conversationId+createdAt]")
      .between([conversationId, fromCreatedAt], [conversationId, Dexie.maxKey], true, true)
      .delete();
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
    await this.db.conversations.update(id, { locale });
  }

  async getLocale(): Promise<Locale> {
    const record = await this.db.settings.get("locale");
    return record !== undefined && record.key === "locale" ? record.value : "zh-CN";
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
