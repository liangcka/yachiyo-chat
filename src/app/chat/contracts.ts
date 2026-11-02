import type { ChatMessage, Conversation, Locale, StoredImage } from "../../domain/chat";
import type { ConversationMetadata } from "../../domain/conversation-metadata";
import type { ActiveLlmConfig } from "../../domain/llm";
import type { UserMemoryRevision } from "../../domain/user-memory";
import type {
  StreamChatOptions,
  StreamChatRequest,
  StreamChatResult,
} from "../../services/chat-client";
import type { SkillDefinition } from "../../skills";
import type { ChatState } from "../chat-reducer";

export interface ChatRepository {
  createConversation(locale: Locale, now?: number): Promise<Conversation>;
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | undefined>;
  listMessages(
    conversationId: string,
    options?: { beforeCreatedAt?: number; limit?: number },
  ): Promise<ChatMessage[]>;
  putMessage(message: ChatMessage): Promise<void>;
  updateConversationSummary(
    id: string,
    summary: string,
    now?: number,
    compressedUpTo?: number,
    compressedUpToId?: string,
    signal?: AbortSignal,
  ): Promise<void>;
  getUserMemory(): Promise<string>;
  /** 自动整理只读取当前会话的事实，避免把其他会话的记忆复制到新来源。 */
  getConversationMemory?(conversationId: string): Promise<string>;
  updateUserMemory(memory: string): Promise<void>;
  listUserMemoryHistory?(): Promise<UserMemoryRevision[]>;
  undoUserMemoryChange?(revisionId: string): Promise<string | undefined>;
  rememberMessageMemory?(
    conversationId: string,
    messageId: string,
    expectedMemory: string,
    memory: string,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
  applyConversationMetadata?(
    conversationId: string,
    messageId: string,
    expectedMemory: string,
    metadata: ConversationMetadata,
    signal?: AbortSignal,
  ): Promise<{ conversation?: Conversation; memory?: string }>;
  /** 将存储中的会话消息截断为给定前缀（定点删除水位线之后的部分） */
  replaceMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;
  deleteMessagesFrom(conversationId: string, fromCreatedAt: number): Promise<void>;
  /** 撤回消息并恢复其记忆更新，返回事务提交后的当前记忆。 */
  recallMessagesFrom?(conversationId: string, fromCreatedAt: number): Promise<string>;
  putImage(image: StoredImage): Promise<void>;
  getImage(id: string): Promise<StoredImage | undefined>;
  setLocale(locale: Locale): Promise<void>;
  getLocale(): Promise<Locale>;
  setConversationLocale(id: string, locale: Locale): Promise<void>;
  renameConversation?(id: string, title: string): Promise<void>;
  touchConversation?(id: string, now?: number): Promise<void>;
  deleteConversation?(id: string): Promise<string | void>;
}

export type StreamChatFunction = (
  request: StreamChatRequest,
  options: StreamChatOptions,
) => Promise<StreamChatResult>;

export interface ChatControllerOptions {
  repository: ChatRepository;
  streamChat?: StreamChatFunction;
  activeLlmConfig?: ActiveLlmConfig;
  /** 已启用的技能，内容将作为技能指令注入每次请求 */
  activeSkills?: readonly SkillDefinition[];
  /** 联网搜索开关，开启后普通聊天请求携带 webSearch: true（summary 压缩不携带） */
  webSearchEnabled?: boolean;
  /** 智能搜索开关，开启后普通聊天请求携带 smartSearch: true（需联网搜索同时开启） */
  webSearchSmart?: boolean;
  /** 分条消息发送开关，关闭后普通聊天请求携带 multiBubble: false */
  multiBubble?: boolean;
  now?: () => number;
  id?: () => string;
}

export interface RecalledMessageData {
  text: string;
  imageId?: string;
}

export type RememberMessageResult = "saved" | "unchanged" | "failed" | "cancelled" | "too-long";

export interface ChatController extends ChatState {
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  stop(): Promise<void>;
  recall(): Promise<RecalledMessageData | undefined>;
  regenerate(messageId?: string): Promise<void>;
  compressConversation(manual?: boolean): Promise<boolean>;
  updateUserMemory(memory: string): Promise<boolean>;
  userMemoryHistory: readonly UserMemoryRevision[];
  refreshUserMemoryHistory(): Promise<void>;
  undoUserMemoryChange(revisionId: string): Promise<boolean>;
  rememberMessage(messageId: string): Promise<RememberMessageResult>;
  newConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  deleteConversation(id: string): Promise<boolean>;
  /** 向上翻页：加载当前窗口之前更早的历史消息（UI 窗口化） */
  loadEarlier(): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  setPendingImage(image?: StoredImage): void;
  setOnline(online: boolean): void;
  clearError(): void;
  /** 等待已启动的生成、消息与记忆写入完成；存储失败时拒绝重载，不中止聊天。 */
  prepareForReload(): Promise<void>;
}
