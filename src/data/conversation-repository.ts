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

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    const messages = await this.db.messages
      .where("conversationId")
      .equals(conversationId)
      .toArray();
    return messages.sort((left, right) => left.createdAt - right.createdAt);
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
    return (await this.db.settings.get("locale"))?.value ?? "zh-CN";
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
