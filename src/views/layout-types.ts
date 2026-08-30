import type { useChatController } from "../app/use-chat-controller";
import type { LlmProviderEntry } from "../components/LlmSettingsPanel";
import type { Conversation, Locale } from "../domain/chat";
import type { ProviderId } from "../domain/llm";
import type { ImageProcessingErrorCode, ProcessedImage } from "../features/capture/image-processor";
import type { UiCopy } from "../i18n/messages";
import type { usePwaUpdate } from "../pwa/use-pwa-update";
import type { WebSearchSettings } from "../services/web-search-settings";

export interface SharedViewProps {
  controller: ReturnType<typeof useChatController>;
  copy: UiCopy;
  isOnline: boolean;
  conversations: Conversation[];
  imageUrls: ReadonlyMap<string, string>;
  pendingImageDataUrl?: string;
  composerValue: string;
  setComposerValue: (value: string) => void;
  activeProviderSupportsImage: boolean;
  activeSkillIds: string[];
  llmActiveProvider?: ProviderId;
  llmEntries: readonly LlmProviderEntry[];
  webSearchSettings: WebSearchSettings;
  pwa: ReturnType<typeof usePwaUpdate>;
  processImage: (file: File) => Promise<ProcessedImage>;
  setPendingImageDataUrl: (url?: string) => void;

  onSend: (value: string) => void;
  onImage: (image: ProcessedImage) => void;
  onRecall: () => Promise<void>;
  onRegenerate: (messageId?: string) => Promise<void>;
  onNewChat: () => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClearData: () => Promise<void>;
  onLocale: (locale: Locale) => Promise<void>;
  onSignOut: () => Promise<void>;
  onLlmSave: (provider: ProviderId, apiKey: string, model: string) => Promise<void>;
  onLlmClear: (provider: ProviderId) => Promise<void>;
  onLlmActivate: (provider: ProviderId) => Promise<void>;
  onSkillToggle: (id: string, next: boolean) => Promise<void>;
  onWebSearchSettingsChange: (partial: Partial<WebSearchSettings>) => void;
  showToast: (message: string, tone?: "info" | "error") => void;
  refreshHistory: () => Promise<void>;
  refreshLlm: () => Promise<void>;
}

export function imageErrorMessage(code: ImageProcessingErrorCode, copy: UiCopy): string {
  if (code === "IMAGE_INVALID") return copy.imageInvalid;
  if (code === "IMAGE_TOO_LARGE") return copy.imageTooLarge;
  return copy.genericFailure;
}

export function controllerErrorMessage(code: string, copy: UiCopy): string {
  if (code === "DAILY_QUOTA_EXCEEDED") return copy.quotaReached;
  if (code === "SESSION_REQUIRED") return copy.sessionExpired;
  if (code === "NETWORK_ERROR") return copy.offline;
  if (code === "CONVERSATION_LIMIT") return copy.conversationLimit;
  if (code === "STORAGE_ERROR") return copy.storageFull;
  return copy.genericFailure;
}
