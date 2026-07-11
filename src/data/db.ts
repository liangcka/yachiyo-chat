import Dexie, { type Table } from "dexie";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";

export interface AppSetting {
  key: "locale";
  value: Locale;
}

export class YachiyoDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<ChatMessage, string>;
  images!: Table<StoredImage, string>;
  settings!: Table<AppSetting, string>;

  constructor(name = "yachiyo-chat") {
    super(name);

    this.version(1).stores({
      conversations: "id, updatedAt, locale",
      messages: "id, conversationId, createdAt, [conversationId+createdAt]",
      images: "id, conversationId",
      settings: "key",
    });
  }
}
