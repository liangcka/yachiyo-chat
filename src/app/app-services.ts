import { ConversationRepository } from "../data/conversation-repository";
import { YachiyoDatabase } from "../data/db";
import type { ConversationSearchResult } from "../domain/conversation-search";
import { processImage, type ProcessedImage } from "../features/capture/image-processor";
import { streamChat } from "../services/chat-client";
import { LlmSettingsService } from "../services/llm-settings";
import { SessionClient } from "../services/session-client";
import { SkillSettingsService } from "../services/skill-settings";
import { WebSearchSettingsService } from "../services/web-search-settings";
import type { ChatRepository, StreamChatFunction } from "./chat/contracts";

export interface AppRepository extends ChatRepository {
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<string | void>;
  clearAll(): Promise<void>;
  getMultiBubble?(): Promise<boolean>;
  setMultiBubble?(multiBubble: boolean): Promise<void>;
  getOnboardingCompleted?(): Promise<boolean>;
  setOnboardingCompleted?(completed: boolean): Promise<void>;
  searchConversations?(query: string): Promise<ConversationSearchResult[]>;
}

export interface SessionService {
  check(signal?: AbortSignal): Promise<boolean>;
  authenticate(accessCode: string, signal?: AbortSignal): Promise<void>;
  signOut(signal?: AbortSignal): Promise<void>;
}

export interface AppServices {
  repository: AppRepository;
  session: SessionService;
  streamChat: StreamChatFunction;
  processImage: (file: File) => Promise<ProcessedImage>;
  llmSettings?: LlmSettingsService;
  skillSettings?: SkillSettingsService;
  webSearchSettings?: WebSearchSettingsService;
}

/** 设置类服务均已就位的应用服务集合；未注入的设置服务回退到生产数据库实例。 */
export type ResolvedAppServices = AppServices &
  Required<Pick<AppServices, "llmSettings" | "skillSettings" | "webSearchSettings">>;

const productionDatabase = new YachiyoDatabase();
const productionServices: ResolvedAppServices = {
  processImage,
  repository: new ConversationRepository(productionDatabase),
  session: new SessionClient(),
  streamChat,
  llmSettings: new LlmSettingsService(productionDatabase),
  skillSettings: new SkillSettingsService(productionDatabase),
  webSearchSettings: new WebSearchSettingsService(productionDatabase),
};

export function resolveAppServices(services?: AppServices): ResolvedAppServices {
  if (services === undefined) return productionServices;
  return {
    ...services,
    llmSettings: services.llmSettings ?? productionServices.llmSettings,
    skillSettings: services.skillSettings ?? productionServices.skillSettings,
    webSearchSettings: services.webSearchSettings ?? productionServices.webSearchSettings,
  };
}
