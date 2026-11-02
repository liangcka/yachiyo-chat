import type { ChatController } from "../app/chat/contracts";
import type { ShowToast } from "../app/use-toast";
import type { Conversation, Locale } from "../domain/chat";
import type { ConversationSearchResult } from "../domain/conversation-search";
import type { LlmProviderEntry, ProviderId } from "../domain/llm";
import type { ProcessedImage } from "../features/capture/image-processor";
import type { UiCopy } from "../i18n/messages";
import type { usePwaUpdate } from "../pwa/use-pwa-update";
import type { WebSearchSettings } from "../services/web-search-settings";

export interface ComposerModel {
  value: string;
  setValue(value: string): void;
  pendingImageDataUrl?: string;
  /** 当前模型是否支持识图；不支持时禁用拍照与相册入口 */
  imageSupported: boolean;
  processImage(file: File): Promise<ProcessedImage>;
  attachImage(image: ProcessedImage): void;
  removeImage(): void;
  send(text: string): void;
}

export interface MessageActionsModel {
  recall(): Promise<void>;
  regenerate(messageId?: string): Promise<void>;
}

export interface ConversationsModel {
  items: Conversation[];
  refresh(): Promise<void>;
  search?: (query: string) => Promise<ConversationSearchResult[]>;
  create(): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SettingsModel {
  llm: {
    entries: readonly LlmProviderEntry[];
    activeProvider?: ProviderId;
    refresh(): Promise<void>;
    save(provider: ProviderId, apiKey: string, model: string): Promise<void>;
    clear(provider: ProviderId): Promise<void>;
    activate(provider: ProviderId): Promise<void>;
  };
  activeSkillIds: readonly string[];
  toggleSkill(id: string, next: boolean): Promise<void>;
  webSearch: WebSearchSettings;
  changeWebSearch(partial: Partial<WebSearchSettings>): void;
  multiBubble: boolean;
  changeMultiBubble(enabled: boolean): Promise<void>;
}

export interface OnboardingModel {
  open: boolean;
  close(): void;
  reopen(): void;
}

export interface AccountModel {
  setLocale(locale: Locale): Promise<void>;
  clearData(): Promise<void>;
  signOut(): Promise<void>;
}

/** 视图层契约：App 负责状态与持久化编排，布局只消费这些模型并管理纯界面状态。 */
export interface SharedViewProps {
  controller: ChatController;
  copy: UiCopy;
  isOnline: boolean;
  imageUrls: ReadonlyMap<string, string>;
  pwa: ReturnType<typeof usePwaUpdate>;
  showToast: ShowToast;
  composer: ComposerModel;
  messageActions: MessageActionsModel;
  conversations: ConversationsModel;
  settings: SettingsModel;
  onboarding: OnboardingModel;
  account: AccountModel;
}
