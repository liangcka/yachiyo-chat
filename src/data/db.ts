import Dexie, { type Table } from "dexie";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";
import type { LlmSettingsRecord, ProviderId } from "../domain/llm";

export type AppSetting =
  | { key: "locale"; value: Locale }
  | { key: "activeProvider"; value: ProviderId }
  | { key: "activeSkills"; value: string[] }
  | { key: "webSearchEnabled"; value: boolean }
  | { key: "webSearchShowSources"; value: boolean }
  | { key: "webSearchSmart"; value: boolean };

export class YachiyoDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<ChatMessage, string>;
  images!: Table<StoredImage, string>;
  settings!: Table<AppSetting, string>;
  llmSettings!: Table<LlmSettingsRecord, ProviderId>;

  constructor(name = "yachiyo-chat") {
    super(name);

    this.version(1).stores({
      conversations: "id, updatedAt, locale",
      messages: "id, conversationId, createdAt, [conversationId+createdAt]",
      images: "id, conversationId",
      settings: "key",
    });

    this.version(2).stores({
      conversations: "id, updatedAt, locale",
      messages: "id, conversationId, createdAt, [conversationId+createdAt]",
      images: "id, conversationId",
      settings: "key",
      llmSettings: "provider",
    });
  }
}
