import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChatMessage, ChatSource, Conversation, Locale, StoredImage, TokenUsage } from "../domain/chat";
import type { ActiveLlmConfig } from "../domain/llm";
import { isUntitledConversation, type ConversationMetadata } from "../domain/conversation-metadata";
import { generateConversationMetadata } from "./conversation-metadata";
import type { UserMemoryRevision } from "../domain/user-memory";
import type { SkillDefinition } from "../skills";
import {
  buildConversationSummaryBatch,
  parseConversationSummary,
  selectConversationSummaryMessages,
} from "./conversation-summary";

import {
  ChatClientError,
  isRetryableChatErrorCode,
  streamChat as streamChatRequest,
  type StreamChatMessage,
  type StreamChatOptions,
  type StreamChatRequest,
  type StreamChatResult,
} from "../services/chat-client";
import {
  chatReducer,
  initialChatState,
  type ChatAction,
  type ChatState,
} from "./chat-reducer";

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

interface ControllerServices {
  repository: ChatRepository;
  streamChat: StreamChatFunction;
  now: () => number;
  id: () => string;
}

interface InitialData {
  conversation: Conversation;
  locale: Locale;
  messages: ChatMessage[];
  userMemory?: string;
  hasMoreHistory?: boolean;
}

interface ActiveRun {
  assistant: ChatMessage;
  controller: AbortController;
  finishing?: Promise<void>;
  preparation: Promise<void>;
  text: string;
  thought?: string;
  provider?: string;
  model?: string;
  usage?: TokenUsage;
  startTime: number;
  /** 联网搜索返回的参考来源（sources 事件先于 delta 到达），随消息持久化 */
  sources?: ReadonlyArray<ChatSource>;
  timer?: ReturnType<typeof setTimeout>;
  token: number;
  metadataGeneration: number;
}

const partialPersistenceInterval = 250;
/** UI 窗口化：初始只加载最近 windowSize 条历史，向上滚动时按 historyLoadStep 条上翻 */
const historyWindowSize = 50;
const historyLoadStep = 30;
/** 流式 delta/thought 用 requestAnimationFrame 合并后再 dispatch，避免逐 chunk 触发全列表 reducer */
const maximumRequestCharacters = 24_000;
const maximumRequestMessageCharacters = 4_000;
const maximumRequestMessages = 20;
/** 未压缩历史消息达到该数量时，发送前自动触发增量压缩（为摘要/长期记忆前缀预留槽位） */
const compressionTriggerUncompressedMessages = maximumRequestMessages - 4;

interface PendingStreamDelta {
  messageId: string;
  text: string;
  type: "delta" | "thought-delta";
}

interface StreamBatcher {
  /** 追加一个待合并的流式增量；返回 true 表示本次调度了 rAF 刷新 */
  push(action: PendingStreamDelta): boolean;
  /** 立即同步派发所有未合并的增量（终态/中止/卸载前必须调用） */
  flush(): void;
}

function createStreamBatcher(
  emitAction: (action: ChatAction) => void,
): StreamBatcher {
  let pending = new Map<string, PendingStreamDelta>();
  let frameHandle: number | undefined;

  const flush = () => {
    if (frameHandle !== undefined) {
      cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    }
    if (pending.size === 0) return;
    const batch = [...pending.values()];
    pending = new Map();
    for (const action of batch) {
      emitAction(action);
    }
  };

  const schedule = () => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      flush();
      return false;
    }
    frameHandle = window.requestAnimationFrame(() => {
      frameHandle = undefined;
      flush();
    });
    return true;
  };

  return {
    push(action) {
      const key = `${action.type}:${action.messageId}`;
      pending.set(key, {
        ...pending.get(key),
        text: (pending.get(key)?.text ?? "") + action.text,
        messageId: action.messageId,
        type: action.type,
      });
      if (frameHandle === undefined) return schedule();
      return false;
    },
    flush,
  };
}

function blobToDataUrl(image: StoredImage): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new TypeError("Image could not be encoded."));
    });
    reader.addEventListener("error", () => reject(new TypeError("Image could not be encoded.")));
    reader.readAsDataURL(image.blob);
  });
}

function isHistoryMessage(message: ChatMessage): boolean {
  return message.status === "complete" || message.status === "stopped";
}

const weekdaysZh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;
const weekdaysJa = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"] as const;

export function formatClientTimestamp(timestamp: number, locale: Locale): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  const weekday = locale === "ja-JP" ? weekdaysJa[date.getDay()] : weekdaysZh[date.getDay()];
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${weekday}`;
}

function truncateUnicode(value: string, maximum: number): string {
  let result = "";
  let length = 0;
  for (const character of value) {
    if (length >= maximum) break;
    result += character;
    length += 1;
  }
  return result;
}

function requestHistory(
  messages: ChatMessage[],
  reserveCharacters = 0,
  maxMessages = maximumRequestMessages,
  compressedUpTo?: number,
): Array<{ message: ChatMessage; text: string }> {
  // 早于压缩边界的消息已被摘要取代，不再重复进入请求（retained-tail 语义）
  const eligible = messages.filter(
    (message) =>
      isHistoryMessage(message) &&
      (compressedUpTo === undefined || message.createdAt > compressedUpTo),
  );
  const selected: Array<{ message: ChatMessage; text: string }> = [];
  let totalCharacters = reserveCharacters;

  for (let index = eligible.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const message = eligible[index];
    if (message === undefined) continue;
    const text = truncateUnicode(message.text, maximumRequestMessageCharacters);
    const isLastMessage = index === eligible.length - 1;
    if (!isLastMessage && text.trim().length === 0) continue;
    const characterLength = [...text].length;
    if (totalCharacters + characterLength > maximumRequestCharacters) break;
    selected.unshift({ message, text });
    totalCharacters += characterLength;
  }

  return selected;
}

/** 仅统计压缩边界之后（未被摘要取代）的 eligible 消息数 */
function countUncompressedMessages(messages: ChatMessage[], compressedUpTo?: number): number {
  return messages.filter(
    (message) =>
      isHistoryMessage(message) &&
      (compressedUpTo === undefined || message.createdAt > compressedUpTo),
  ).length;
}

/**
 * 派生叠加视图：流式期间增量写在 state.streaming 槽位里，这里把累积文本叠到
 * 对应消息上再交给 UI，保证组件层看到的仍是"最后一条消息的 text 在增长"。
 */
function overlayStreamedText(state: ChatState): ChatMessage[] {
  const streaming = state.streaming;
  if (streaming === undefined) return state.messages;
  const index = state.messages.findIndex((message) => message.id === streaming.messageId);
  if (index < 0) return state.messages;
  return state.messages.map((message, i) =>
    i === index
      ? {
          ...message,
          ...(streaming.text !== undefined ? { text: message.text + streaming.text } : {}),
          thought:
            streaming.thought === undefined
              ? message.thought
              : ((message.thought ?? "") + streaming.thought) || undefined,
        }
      : message,
  );
}

export function useChatController(options: ChatControllerOptions): ChatController {
  const servicesRef = useRef<ControllerServices>({
    id: options.id ?? (() => crypto.randomUUID()),
    now: options.now ?? (() => Date.now()),
    repository: options.repository,
    streamChat: options.streamChat ?? streamChatRequest,
  });
  const activeLlmConfigRef = useRef<ActiveLlmConfig | undefined>(options.activeLlmConfig);
  useEffect(() => {
    activeLlmConfigRef.current = options.activeLlmConfig;
  }, [options.activeLlmConfig]);
  const activeSkillsRef = useRef<readonly SkillDefinition[] | undefined>(options.activeSkills);
  useEffect(() => {
    activeSkillsRef.current = options.activeSkills;
  }, [options.activeSkills]);
  const webSearchEnabledRef = useRef<boolean>(options.webSearchEnabled ?? false);
  useEffect(() => {
    webSearchEnabledRef.current = options.webSearchEnabled ?? false;
  }, [options.webSearchEnabled]);
  const webSearchSmartRef = useRef<boolean>(options.webSearchSmart ?? false);
  useEffect(() => {
    webSearchSmartRef.current = options.webSearchSmart ?? false;
  }, [options.webSearchSmart]);
  const multiBubbleRef = useRef<boolean>(options.multiBubble ?? true);
  useEffect(() => {
    multiBubbleRef.current = options.multiBubble ?? true;
  }, [options.multiBubble]);
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [userMemoryHistory, setUserMemoryHistory] = useState<readonly UserMemoryRevision[]>([]);
  const memoryHistoryRequestRef = useRef(0);
  const stateRef = useRef<ChatState>(initialChatState);
  const activeRef = useRef<ActiveRun | undefined>(undefined);
  const compressControllerRef = useRef<AbortController | undefined>(undefined);
  const metadataControllerRef = useRef<AbortController | undefined>(undefined);
  const metadataGenerationRef = useRef(0);
  const lastCompressionAttemptRef = useRef<{ timestamp: number; failed: boolean }>({ failed: false, timestamp: 0 });
  const initializationRef = useRef<Promise<InitialData> | undefined>(undefined);
  const mountedRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistenceFailedRef = useRef(false);
  const metadataTasksRef = useRef(new Set<Promise<unknown>>());
  const runTokenRef = useRef(0);
  const sendingRef = useRef(false);
  const sendingCompletionRef = useRef<{ promise: Promise<void>; resolve: () => void } | undefined>(undefined);
  const lastTimestampRef = useRef(0);

  const setSending = useCallback((sending: boolean): void => {
    sendingRef.current = sending;
    if (sending) {
      if (sendingCompletionRef.current === undefined) {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => { resolve = done; });
        sendingCompletionRef.current = { promise, resolve };
      }
    } else {
      sendingCompletionRef.current?.resolve();
      sendingCompletionRef.current = undefined;
    }
  }, []);

  const trackPersistence = useCallback(<T,>(task: Promise<T>): Promise<T> => {
    persistQueueRef.current = task.then(() => undefined, () => {
      persistenceFailedRef.current = true;
    });
    return task;
  }, []);

  const trackMetadata = useCallback(<T,>(task: Promise<T>): Promise<T> => {
    metadataTasksRef.current.add(task);
    void task.then(() => metadataTasksRef.current.delete(task), () => metadataTasksRef.current.delete(task));
    return task;
  }, []);

  const prepareForReload = useCallback(async (): Promise<void> => {
    while (true) {
      if (sendingCompletionRef.current !== undefined) await sendingCompletionRef.current.promise;
      const queue = persistQueueRef.current;
      await Promise.all([queue, ...metadataTasksRef.current]);
      // 等待期间仍可继续聊天；新增的生成或写入必须进入下一轮实际任务等待。
      if (sendingRef.current || queue !== persistQueueRef.current || metadataTasksRef.current.size > 0) continue;
      if (persistenceFailedRef.current || stateRef.current.errorCode === "STORAGE_ERROR") {
        throw new Error("本地数据尚未成功保存，不能重载应用。");
      }
      return;
    }
  }, []);

  const nextTimestamp = useCallback(() => {
    const timestamp = Math.max(servicesRef.current.now(), lastTimestampRef.current + 1);
    lastTimestampRef.current = timestamp;
    return timestamp;
  }, []);

  const emit = useCallback((action: ChatAction) => {
    stateRef.current = chatReducer(stateRef.current, action);
    dispatch(action);
  }, []);

  const cancelMetadata = useCallback(() => {
    metadataGenerationRef.current += 1;
    metadataControllerRef.current?.abort();
    metadataControllerRef.current = undefined;
  }, []);

  const refreshUserMemoryHistory = useCallback(async (): Promise<void> => {
    const request = ++memoryHistoryRequestRef.current;
    try {
      const history = await servicesRef.current.repository.listUserMemoryHistory?.() ?? [];
      if (mountedRef.current && request === memoryHistoryRequestRef.current) setUserMemoryHistory(history);
    } catch {
      // 历史读取失败不影响已有记忆与聊天，重新打开面板时重试。
    }
  }, []);

  useEffect(() => { void refreshUserMemoryHistory(); }, [refreshUserMemoryHistory, state.userMemory]);

  const updateMetadata = useCallback(async (assistant: ChatMessage): Promise<void> => {
    const snapshot = stateRef.current;
    const conversation = snapshot.activeConversation;
    const user = [...snapshot.messages].reverse().find((message) => message.role === "user");
    const repository = servicesRef.current.repository;
    if (!mountedRef.current || conversation?.id !== assistant.conversationId || user === undefined ||
      repository.applyConversationMetadata === undefined) return;
    cancelMetadata();
    const controller = new AbortController();
    metadataControllerRef.current = controller;
    const config = activeLlmConfigRef.current;
    const timer = setTimeout(() => controller.abort(), 30_000);
    let writing = false;
    try {
      const memory = await repository.getUserMemory();
      const conversationMemory = await repository.getConversationMemory?.(conversation.id) ?? memory;
      if (controller.signal.aborted) return;
      const metadata = await generateConversationMetadata({
        conversation, user, assistant, memory: conversationMemory, config,
        streamChat: servicesRef.current.streamChat,
        signal: controller.signal,
      });
      if (metadata === undefined || controller.signal.aborted || !mountedRef.current) return;
      writing = true;
      const applied = await repository.applyConversationMetadata(
        conversation.id, assistant.id, memory, metadata, controller.signal,
      );
      if (controller.signal.aborted || !mountedRef.current) return;
      if (applied.conversation !== undefined) {
        emit({ type: "conversation-metadata-updated", conversation: applied.conversation });
      }
      if (applied.memory !== undefined) emit({ type: "user-memory-updated", memory: applied.memory });
    } catch {
      if (writing && !controller.signal.aborted) persistenceFailedRef.current = true;
      // 后台整理失败保留已保存内容，下一次完整对话可重试。
    } finally {
      clearTimeout(timer);
      if (metadataControllerRef.current === controller) metadataControllerRef.current = undefined;
    }
  }, [cancelMetadata, emit]);

  const streamBatcherRef = useRef<StreamBatcher | undefined>(undefined);
  useEffect(() => {
    const batcher = createStreamBatcher(emit);
    streamBatcherRef.current = batcher;
    return () => {
      batcher.flush();
      if (streamBatcherRef.current === batcher) streamBatcherRef.current = undefined;
    };
  }, [emit]);

  const queueMessage = useCallback((message: ChatMessage): Promise<void> => {
    const task = persistQueueRef.current.then(() =>
      servicesRef.current.repository.putMessage(message),
    );
    return trackPersistence(task);
  }, [trackPersistence]);

  const createConversation = useCallback(
    async (locale: Locale): Promise<InitialData> => {
      const conversation = await servicesRef.current.repository.createConversation(
        locale,
        nextTimestamp(),
      );
      return { conversation, locale, messages: [], hasMoreHistory: false };
    },
    [nextTimestamp],
  );

  useEffect(() => {
    mountedRef.current = true;
    let ignored = false;

    initializationRef.current ??= (async () => {
      const [locale, conversations, userMemory] = await Promise.all([
        servicesRef.current.repository.getLocale(),
        servicesRef.current.repository.listConversations(),
        servicesRef.current.repository.getUserMemory().catch(() => ""),
      ]);
      const latest = conversations[0];
      if (latest === undefined) {
        return { ...(await createConversation(locale)), userMemory };
      }
      lastTimestampRef.current = Math.max(lastTimestampRef.current, latest.updatedAt);
      // UI 窗口化：只加载最近 windowSize 条，更早历史经 loadEarlier 按需上翻；
      // 多取 1 条探测是否还有更早历史（hasMoreHistory），避免额外的计数查询
      const storedMessages = await servicesRef.current.repository.listMessages(latest.id, {
        limit: historyWindowSize + 1,
      });
      const hasMoreHistory = storedMessages.length > historyWindowSize;
      const messages = storedMessages.slice(hasMoreHistory ? 1 : 0).map((message) =>
        message.status === "streaming" ? { ...message, status: "stopped" as const } : message,
      );
      for (let index = 0; index < messages.length; index += 1) {
        if (messages[index] !== storedMessages[index]) await queueMessage(messages[index]!);
      }
      if (locale !== latest.locale) await servicesRef.current.repository.setLocale(latest.locale);
      return {
        conversation: latest,
        locale: latest.locale,
        messages,
        userMemory,
        hasMoreHistory,
      };
    })();

    void initializationRef.current
      .then((loaded) => {
        if (!ignored && mountedRef.current) {
          emit({
            conversation: loaded.conversation,
            locale: loaded.locale,
            messages: loaded.messages,
            type: "loaded",
            ...(loaded.userMemory !== "" ? { userMemory: loaded.userMemory } : {}),
            ...(loaded.hasMoreHistory ? { hasMoreHistory: true } : {}),
          });
        }
      })
      .catch(() => {
        if (!ignored && mountedRef.current) {
          emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        }
      });

    return () => {
      ignored = true;
      mountedRef.current = false;
      cancelMetadata();
      const compressController = compressControllerRef.current;
      if (compressController !== undefined) {
        compressControllerRef.current = undefined;
        compressController.abort();
      }
      const active = activeRef.current;
      if (active !== undefined) {
        activeRef.current = undefined;
        if (active.timer !== undefined) clearTimeout(active.timer);
        streamBatcherRef.current?.flush();
        active.controller.abort();
        void active.preparation
          .catch(() => undefined)
          .then(() =>
            queueMessage({
              ...active.assistant,
              status: "stopped",
              text: active.text,
            }),
          )
          .catch(() => undefined);
      }
    };
  }, [cancelMetadata, createConversation, emit, queueMessage]);

  const makeRequestMessages = useCallback(
    async (
      messages: ChatMessage[],
      pendingImage?: StoredImage,
      reserveCharacters = 0,
      overrideSummary?: string,
    ): Promise<StreamChatMessage[]> => {
      const activeSkills = activeSkillsRef.current ?? [];
      const hasSkills = activeSkills.length > 0;
      const skillUserText = hasSkills
        ? `【技能指令 / Skill Instructions】\n以下技能已激活，回复时必须严格遵守：\n\n${activeSkills
            .map((skill) => skill.content)
            .join("\n\n---\n\n")}`
        : "";
      const skillAssistantText = hasSkills
        ? stateRef.current.locale === "ja-JP"
          ? "（技能指示を確認しました。厳守して実行します）"
          : "（已收到技能指令，将严格遵守执行）"
        : "";
      const skillChars = hasSkills
        ? [...skillUserText].length + [...skillAssistantText].length
        : 0;

      const activeUserMemory = truncateUnicode(stateRef.current.userMemory ?? "", 3000);
      const hasUserMemory =
        typeof activeUserMemory === "string" && activeUserMemory.trim().length > 0;

      const memoryUserText = hasUserMemory
        ? stateRef.current.locale === "ja-JP"
          ? `【彩葉についての長期記憶（全ての会話で共有される事実）】\n${activeUserMemory.trim()}\nこれは実際に起きた確定した事実として扱ってください。`
          : `【关于彩叶的长期记忆（所有对话共享的事实）】\n${activeUserMemory.trim()}\n以下内容请作为真实发生的既定事实对待。`
        : "";
      const memoryAssistantText = hasUserMemory
        ? stateRef.current.locale === "ja-JP"
          ? "（彩葉のこと、ちゃんと覚えていますよ）"
          : "（关于彩叶的事情，我一直都记得哦~）"
        : "";

      const memoryChars = hasUserMemory
        ? [...memoryUserText].length + [...memoryAssistantText].length
        : 0;

      const activeSummary = truncateUnicode(overrideSummary ?? stateRef.current.activeConversation?.summary ?? "", 3000);
      const hasSummary = typeof activeSummary === "string" && activeSummary.trim().length > 0;

      const summaryUserText = hasSummary
        ? stateRef.current.locale === "ja-JP"
          ? `【これまでの会話の記憶・背景（実際に起きた確定した事実）】\n${activeSummary.trim()}\nこれは私たちが実際に経験した会話の記録です。既定の事実として守り、引き継いでください。`
          : `【前情提要 / 历史背景记忆（真实发生的既定事实）】\n${activeSummary.trim()}\n这是我们真实经历过的对话记录，请作为既定事实遵守并延续。`
        : "";
      const summaryAssistantText = hasSummary
        ? stateRef.current.locale === "ja-JP"
          ? "（これまでの経緯と記憶を把握しました。会話を続けます）"
          : "（已记住我们之前的对话与经历，继续交流~）"
        : "";

      const summaryChars = hasSummary
        ? [...summaryUserText].length + [...summaryAssistantText].length
        : 0;

      const reservedPrefixMessages =
        (hasSkills ? 2 : 0) + (hasUserMemory ? 2 : 0) + (hasSummary ? 2 : 0);
      const maxHistoryMessages = maximumRequestMessages - reservedPrefixMessages;
      const history = requestHistory(
        messages,
        reserveCharacters + summaryChars + memoryChars + skillChars,
        maxHistoryMessages,
        stateRef.current.activeConversation?.compressedUpTo,
      );
      const lastIndex = history.length - 1;

      const chatMessages = await Promise.all(
        history.map(async ({ message, text }, index) => {
          const requestMessage: StreamChatMessage = {
            role: message.role,
            text,
          };
          if (index === lastIndex && message.role === "user" && message.imageId !== undefined) {
            const image =
              pendingImage?.id === message.imageId
                ? pendingImage
                : await servicesRef.current.repository.getImage(message.imageId);
            if (image !== undefined) requestMessage.imageDataUrl = await blobToDataUrl(image);
          }
          return requestMessage;
        }),
      );

      const prefixMessages: StreamChatMessage[] = [];
      if (hasSkills) {
        prefixMessages.push(
          { role: "user", text: skillUserText },
          { role: "assistant", text: skillAssistantText },
        );
      }
      if (hasUserMemory) {
        prefixMessages.push(
          { role: "user", text: memoryUserText },
          { role: "assistant", text: memoryAssistantText },
        );
      }
      if (hasSummary) {
        prefixMessages.push(
          { role: "user", text: summaryUserText },
          { role: "assistant", text: summaryAssistantText },
        );
      }

      return [...prefixMessages, ...chatMessages];
    },
    [],
  );

  const finishRun = useCallback(
    async (
      run: ActiveRun,
      status: "complete" | "failed" | "stopped",
      errorCode?: string,
      truncated?: boolean,
      usage?: TokenUsage,
    ): Promise<void> => {
      if (run.finishing !== undefined) return run.finishing;
      run.finishing = (async () => {
        if (activeRef.current?.token !== run.token) return;
        activeRef.current = undefined;
        if (run.timer !== undefined) clearTimeout(run.timer);
        // 终态（completed/stopped/failed）必须晚于所有已缓冲的流式增量落地
        streamBatcherRef.current?.flush();
        const latencyMs = Math.max(0, servicesRef.current.now() - run.startTime);
        const finalUsage = usage ?? run.usage;
        const message: ChatMessage = {
          ...run.assistant,
          status,
          text: run.text,
          ...(run.thought !== undefined && run.thought.length > 0 ? { thought: run.thought } : {}),
          ...(run.provider !== undefined ? { provider: run.provider } : {}),
          ...(run.model !== undefined ? { model: run.model } : {}),
          ...(finalUsage !== undefined ? { usage: finalUsage } : {}),
          latencyMs,
          ...(status === "stopped" ? { interrupted: true } : {}),
          ...(truncated === true ? { truncated: true } : {}),
          ...(run.sources !== undefined ? { sources: run.sources } : {}),
        };
        if (mountedRef.current) {
          if (status === "complete") {
            emit({ messageId: run.assistant.id, type: "completed", usage: finalUsage, latencyMs });
          } else if (status === "stopped") {
            emit({ messageId: run.assistant.id, type: "stopped", latencyMs });
          } else {
            emit({
              errorCode: errorCode ?? "SERVICE_UNAVAILABLE",
              messageId: run.assistant.id,
              type: "failed",
              latencyMs,
            });
          }
        }
        let persisted = true;
        await queueMessage(message).catch(() => {
          persisted = false;
          if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        });
        if (persisted && status === "complete" && truncated !== true && !run.controller.signal.aborted &&
          metadataGenerationRef.current === run.metadataGeneration) {
          void trackMetadata(updateMetadata(message));
        }
      })();
      return run.finishing;
    },
    [emit, queueMessage, trackMetadata, updateMetadata],
  );

  const startAssistant = useCallback(
    async (
      history: ChatMessage[],
      user: ChatMessage | undefined,
      pendingImage?: StoredImage,
    ): Promise<void> => {
      cancelMetadata();
      const activeConfig = activeLlmConfigRef.current;
      const currentProvider = activeConfig?.provider ?? "glm";
      const currentModel = activeConfig?.model ?? "glm-4.7-flash";
      const assistant: ChatMessage = {
        conversationId: history.at(-1)?.conversationId ?? "",
        createdAt: nextTimestamp(),
        id: servicesRef.current.id(),
        role: "assistant",
        status: "streaming",
        text: "",
        provider: currentProvider,
        model: currentModel,
      };

      const run: ActiveRun = {
        assistant,
        controller: new AbortController(),
        preparation: Promise.resolve(),
        text: "",
        provider: currentProvider,
        model: currentModel,
        startTime: servicesRef.current.now(),
        token: ++runTokenRef.current,
        metadataGeneration: metadataGenerationRef.current,
      };
      activeRef.current = run;
      emit({ assistant, type: "send-started", user });

      run.preparation = (async () => {
        if (user !== undefined) await queueMessage(user);
        if (pendingImage !== undefined) {
          await servicesRef.current.repository.putImage(pendingImage);
        }
        await queueMessage(assistant);
      })();

      try {
        await run.preparation;
      } catch {
        await finishRun(run, "failed", "STORAGE_ERROR");
        return;
      }
      if (activeRef.current?.token !== run.token) return;
      if (run.controller.signal.aborted) {
        await finishRun(run, "stopped");
        return;
      }

      const schedulePartialPersistence = () => {
        if (run.timer !== undefined || activeRef.current?.token !== run.token) return;
        run.timer = setTimeout(() => {
          run.timer = undefined;
          if (activeRef.current?.token !== run.token) return;
          void queueMessage({
            ...run.assistant,
            status: "streaming",
            text: run.text,
            ...(run.thought !== undefined ? { thought: run.thought } : {}),
            ...(run.provider !== undefined ? { provider: run.provider } : {}),
            ...(run.model !== undefined ? { model: run.model } : {}),
            ...(run.sources !== undefined ? { sources: run.sources } : {}),
          }).catch(() => undefined);
        }, partialPersistenceInterval);
      };

      try {
        const requestMessages = await makeRequestMessages(history, pendingImage);
        // 流正常结束但零输出（如推理模型思考耗尽 token 预算）视为可重试失败，
        // 避免空气泡被静默隐藏
        const currentTime = formatClientTimestamp(
          servicesRef.current.now(),
          stateRef.current.locale,
        );
        const eligibleHistory = history.filter(isHistoryMessage);
        const currentMsg = eligibleHistory.at(-1);
        const previousMsg = eligibleHistory.at(-2);
        const lastMessageIntervalMs =
          currentMsg !== undefined && previousMsg !== undefined
            ? Math.max(0, currentMsg.createdAt - previousMsg.createdAt)
            : undefined;
        const previousTime =
          previousMsg !== undefined
            ? formatClientTimestamp(previousMsg.createdAt, stateRef.current.locale)
            : undefined;

        const result = await servicesRef.current.streamChat(
          {
            locale: stateRef.current.locale,
            messages: requestMessages,
            currentTime,
            ...(previousTime !== undefined ? { previousTime } : {}),
            ...(lastMessageIntervalMs !== undefined ? { lastMessageIntervalMs } : {}),
            ...(activeConfig !== undefined
              ? { provider: activeConfig.provider, apiKey: activeConfig.apiKey, model: activeConfig.model }
              : {}),
            ...(webSearchEnabledRef.current === true ? { webSearch: true } : {}),
            ...(webSearchEnabledRef.current === true && webSearchSmartRef.current === true
              ? { smartSearch: true }
              : {}),
            ...(multiBubbleRef.current === false ? { multiBubble: false } : {}),
          },
          {
            onDelta(text) {
              if (activeRef.current?.token !== run.token || text.length === 0) return;
              run.text += text;
              streamBatcherRef.current?.push({ messageId: run.assistant.id, text, type: "delta" });
              schedulePartialPersistence();
            },
            onThought(text) {
              if (activeRef.current?.token !== run.token || text.length === 0) return;
              run.thought = (run.thought ?? "") + text;
              streamBatcherRef.current?.push({
                messageId: run.assistant.id,
                text,
                type: "thought-delta",
              });
              schedulePartialPersistence();
            },
            onSources(sources) {
              if (activeRef.current?.token !== run.token || sources.length === 0) return;
              run.sources = sources;
              emit({ messageId: run.assistant.id, sources, type: "sources-received" });
              schedulePartialPersistence();
            },
            signal: run.controller.signal,
          },
        );
        await finishRun(
          run,
          run.text.length === 0 ? "failed" : "complete",
          run.text.length === 0 ? "PROVIDER_ERROR" : undefined,
          run.text.length === 0 ? undefined : result.truncated,
          result.usage,
        );
      } catch (error) {
        if (activeRef.current?.token !== run.token) return;
        const code =
          error instanceof ChatClientError
            ? error.code
            : run.controller.signal.aborted
              ? "ABORTED"
              : "SERVICE_UNAVAILABLE";
        if (code === "ABORTED") await finishRun(run, "stopped");
        else await finishRun(run, "failed", code);
      }
    },
    [cancelMetadata, emit, finishRun, makeRequestMessages, nextTimestamp, queueMessage],
  );

  const compressConversation = useCallback(
    async (): Promise<boolean> => {
      const snapshot = stateRef.current;
      if (
        sendingRef.current ||
        snapshot.activeConversation === undefined ||
        snapshot.phase === "loading" ||
        snapshot.phase === "streaming" ||
        snapshot.phase === "compressing" ||
        snapshot.phase === "offline"
      ) {
        return false;
      }

      const controller = new AbortController();
      compressControllerRef.current = controller;
      setSending(true);
      emit({ type: "compress-started" });
      const conversationId = snapshot.activeConversation.id;
      const isCurrent = (): boolean =>
        mountedRef.current &&
        !controller.signal.aborted &&
        stateRef.current.activeConversation?.id === conversationId;

      try {
        await persistQueueRef.current;
        const storedMessages = await servicesRef.current.repository.listMessages(conversationId);
        if (!isCurrent()) return false;
        const pending = selectConversationSummaryMessages(
          storedMessages,
          snapshot.activeConversation.compressedUpTo,
        );
        const lastIncluded = pending.at(-1);
        if (lastIncluded === undefined) return false;

        const activeConfig = activeLlmConfigRef.current;
        let summary = snapshot.activeConversation.summary;
        let processed = 0;
        while (processed < pending.length) {
          const batch = buildConversationSummaryBatch(
            pending.slice(processed),
            snapshot.locale,
            summary,
            {
              messages: maximumRequestMessages,
              messageCharacters: maximumRequestMessageCharacters,
              totalCharacters: maximumRequestCharacters,
            },
          );
          if (batch === undefined || !isCurrent()) return false;
          let output = "";
          const result = await servicesRef.current.streamChat(
            {
              locale: snapshot.locale,
              messages: batch.messages,
              mode: "summary",
              ...(activeConfig !== undefined
                ? { provider: activeConfig.provider, apiKey: activeConfig.apiKey, model: activeConfig.model }
                : {}),
            },
            {
              onDelta(text) {
                output += text;
              },
              signal: controller.signal,
            },
          );
          if (!isCurrent()) return false;
          summary = parseConversationSummary(output, result.truncated);
          if (summary === undefined) return false;
          processed += batch.included.length;
        }

        if (summary === undefined || !isCurrent()) return false;
        await servicesRef.current.repository.updateConversationSummary(
          conversationId,
          summary,
          nextTimestamp(),
          lastIncluded.createdAt,
          lastIncluded.id,
          controller.signal,
        );
        if (!isCurrent()) return false;
        emit({
          type: "context-compressed",
          summary,
          compressedUpTo: lastIncluded.createdAt,
          compressedUpToId: lastIncluded.id,
        });
        return true;
      } catch {
        return false;
      } finally {
        if (compressControllerRef.current === controller || compressControllerRef.current === undefined) {
          compressControllerRef.current = undefined;
          setSending(false);
          if (isCurrent()) emit({ type: "clear-error" });
        }
      }
    },
    [emit, nextTimestamp, setSending],
  );
  const send = useCallback(
    async (text: string): Promise<void> => {
      const snapshot = stateRef.current;
      if (
        sendingRef.current ||
        snapshot.activeConversation === undefined ||
        snapshot.phase === "loading" ||
        snapshot.phase === "streaming" ||
        snapshot.phase === "compressing" ||
        snapshot.phase === "offline"
      ) {
        return;
      }

      const normalized = text.trim();
      if (normalized.length === 0 && snapshot.pendingImage === undefined) return;

      const targetConversationId = snapshot.activeConversation.id;
      const currentMessages = snapshot.messages;
      setSending(true);
        try {
        // 未压缩历史达到阈值且非失败冷却期时先增量压缩，再发送（为摘要/长期记忆前缀预留槽位）
        const lastAttempt = lastCompressionAttemptRef.current;
        const failureCooldown = 120_000;
        const isCooldown =
          lastAttempt.failed &&
          servicesRef.current.now() - lastAttempt.timestamp < failureCooldown;

        if (
          !isCooldown &&
          countUncompressedMessages(
            currentMessages,
            snapshot.activeConversation.compressedUpTo,
          ) >= compressionTriggerUncompressedMessages
        ) {
          setSending(false);
          const success = await compressConversation();
          lastCompressionAttemptRef.current = {
            failed: !success,
            timestamp: servicesRef.current.now(),
          };
          setSending(true);

          const currentSnapshot = stateRef.current;
          if (
            !mountedRef.current ||
            currentSnapshot.activeConversation?.id !== targetConversationId ||
            currentSnapshot.phase === "offline"
          ) {
            return;
          }
        }

        const currentSnapshot = stateRef.current;
        if (
          !mountedRef.current ||
          currentSnapshot.activeConversation?.id !== targetConversationId ||
          currentSnapshot.phase === "offline"
        ) {
          return;
        }

        const image =
          currentSnapshot.pendingImage === undefined
            ? undefined
            : { ...currentSnapshot.pendingImage, conversationId: targetConversationId };
        const user: ChatMessage = {
          conversationId: targetConversationId,
          createdAt: nextTimestamp(),
          ...(image === undefined ? {} : { imageId: image.id }),
          id: servicesRef.current.id(),
          role: "user",
          status: "complete",
          text: normalized,
        };
        await startAssistant([...stateRef.current.messages, user], user, image);
      } catch {
        if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      } finally {
        setSending(false);
      }
    },
    [compressConversation, emit, nextTimestamp, setSending, startAssistant],
  );

  const retry = useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    if (
      sendingRef.current ||
      snapshot.activeConversation === undefined ||
      snapshot.phase === "loading" ||
      snapshot.phase === "streaming" ||
      snapshot.phase === "offline" ||
      !isRetryableChatErrorCode(snapshot.errorCode) ||
      !snapshot.messages.some(({ role }) => role === "user")
    ) {
      return;
    }
    setSending(true);
    try {
      await startAssistant(snapshot.messages, undefined);
    } finally {
      setSending(false);
    }
  }, [setSending, startAssistant]);

  const stop = useCallback(async (): Promise<void> => {
    cancelMetadata();
    const compressController = compressControllerRef.current;
    if (compressController !== undefined) {
      compressControllerRef.current = undefined;
      compressController.abort();
      if (mountedRef.current) emit({ type: "clear-error" });
    }
    const run = activeRef.current;
    if (run === undefined) return;
    run.controller.abort();
    await run.preparation.catch(() => undefined);
    await finishRun(run, "stopped");
  }, [cancelMetadata, emit, finishRun]);

  const recall = useCallback(async (): Promise<RecalledMessageData | undefined> => {
    const snapshot = stateRef.current;
    if (
      snapshot.activeConversation === undefined ||
      snapshot.phase === "loading" ||
      snapshot.phase === "compressing"
    ) {
      return undefined;
    }

    const messages = snapshot.messages;
    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }

    if (lastUserIndex === -1) {
      return undefined;
    }

    cancelMetadata();

    const compressController = compressControllerRef.current;
    if (compressController !== undefined) {
      compressControllerRef.current = undefined;
      compressController.abort();
      if (mountedRef.current) emit({ type: "clear-error" });
    }

    const active = activeRef.current;
    if (active !== undefined) {
      activeRef.current = undefined;
      if (active.timer !== undefined) clearTimeout(active.timer);
      streamBatcherRef.current?.flush();
      active.controller.abort();
    }

    const recalledUser = messages[lastUserIndex];
    if (recalledUser === undefined) return undefined;

    const remainingMessages = messages.slice(0, lastUserIndex);
    const conversationId = snapshot.activeConversation.id;

    try {
      const task = persistQueueRef.current.then(async () => {
        const repository = servicesRef.current.repository;
        if (repository.recallMessagesFrom !== undefined) {
          return repository.recallMessagesFrom(conversationId, recalledUser.createdAt);
        }
        await repository.deleteMessagesFrom(
          conversationId,
          recalledUser.createdAt,
        );
      });
      trackPersistence(task);
      const memory = await task;

      if (mountedRef.current) {
        if (memory !== undefined) emit({ type: "user-memory-updated", memory });
        emit({ messages: remainingMessages, fromCreatedAt: recalledUser.createdAt, type: "messages-reverted" });
      }

      return {
        imageId: recalledUser.imageId,
        text: recalledUser.text,
      };
    } catch {
      if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      return undefined;
    }
  }, [cancelMetadata, emit, trackPersistence]);

  const regenerate = useCallback(
    async (messageId?: string): Promise<void> => {
      const snapshot = stateRef.current;
      if (
        sendingRef.current ||
        snapshot.activeConversation === undefined ||
        snapshot.phase === "loading" ||
        snapshot.phase === "streaming" ||
        snapshot.phase === "compressing" ||
        snapshot.phase === "offline"
      ) {
        return;
      }

      const messages = snapshot.messages;
      let targetIndex = -1;
      if (messageId !== undefined) {
        targetIndex = messages.findIndex(
          (msg) => msg.id === messageId && msg.role === "assistant",
        );
      } else {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === "assistant") {
            targetIndex = index;
            break;
          }
        }
      }

      if (targetIndex === -1) return;

      const precedingMessages = messages.slice(0, targetIndex);
      const hasPrecedingUser = precedingMessages.some((msg) => msg.role === "user");
      if (!hasPrecedingUser) return;

      cancelMetadata();

      const compressController = compressControllerRef.current;
      if (compressController !== undefined) {
        compressControllerRef.current = undefined;
        compressController.abort();
        if (mountedRef.current) emit({ type: "clear-error" });
      }

      const active = activeRef.current;
      if (active !== undefined) {
        activeRef.current = undefined;
        if (active.timer !== undefined) clearTimeout(active.timer);
        streamBatcherRef.current?.flush();
        active.controller.abort();
      }

      setSending(true);
      const conversationId = snapshot.activeConversation.id;
      // 水位线 = 被重生成的 assistant 消息；它及其后的所有记录（含窗口外）定点删除
      const targetMessage = messages[targetIndex]!;

      try {
        const task = persistQueueRef.current.then(async () => {
          await servicesRef.current.repository.deleteMessagesFrom(
            conversationId,
            targetMessage.createdAt,
          );
        });
        trackPersistence(task);
        await task;

        if (mountedRef.current) {
          emit({ messages: precedingMessages, fromCreatedAt: targetMessage.createdAt, type: "messages-reverted" });
        }

        await startAssistant(precedingMessages, undefined);
      } catch {
        if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      } finally {
        setSending(false);
      }
    },
    [cancelMetadata, emit, setSending, startAssistant, trackPersistence],
  );

  const stopAndWait = useCallback(async () => {
    await stop();
  }, [stop]);

  const newConversation = useCallback(async (): Promise<void> => {
    await stopAndWait();
    const repository = servicesRef.current.repository;
    const currentActive = stateRef.current.activeConversation;
    const currentLocale = stateRef.current.locale;

    // 1. 若当前活跃会话本身就是空会话且底层存储依然存在，直接停留在当前会话
    if (
      currentActive !== undefined &&
      stateRef.current.messages.length === 0 &&
      !stateRef.current.hasMoreHistory
    ) {
      try {
        const existing = await repository.getConversation(currentActive.id);
        if (existing !== undefined) {
          if (stateRef.current.pendingImage !== undefined) {
            emit({ type: "pending-image-changed", image: undefined });
          }
          if (stateRef.current.errorCode !== undefined) {
            emit({ type: "clear-error" });
          }
          return;
        }
      } catch {
        // 存储查询异常时降级走后续流程
      }
    }

    // 2. 若当前会话非空，检查存储中是否已有其他未使用的默认空会话（避免产生多个空会话）
    try {
      const conversations = await repository.listConversations();
      let targetEmptyConversation: Conversation | undefined;

      for (const conversation of conversations) {
        if (conversation.id === currentActive?.id) continue;
        const messages = await repository.listMessages(conversation.id, { limit: 1 });
        if (
          messages.length === 0 &&
          isUntitledConversation(conversation)
        ) {
          if (targetEmptyConversation === undefined) {
            targetEmptyConversation = conversation;
          } else if (repository.deleteConversation !== undefined) {
            // 清理多余的历史遗留默认空会话
            await repository.deleteConversation(conversation.id).catch(() => undefined);
          }
        }
      }

      if (targetEmptyConversation !== undefined) {
        const now = nextTimestamp();
        const expectedTitle = currentLocale === "ja-JP" ? "新しい会話" : "新的对话";
        await repository.touchConversation?.(targetEmptyConversation.id, now);
        if (targetEmptyConversation.locale !== currentLocale) {
          await repository.setConversationLocale(targetEmptyConversation.id, currentLocale);
        }
        await repository.setLocale(currentLocale);
        emit({
          conversation: {
            ...targetEmptyConversation,
            locale: currentLocale,
            title: expectedTitle,
            updatedAt: now,
          },
          messages: [],
          type: "conversation-selected",
        });
        if (stateRef.current.pendingImage !== undefined) {
          emit({ type: "pending-image-changed", image: undefined });
        }
        if (stateRef.current.errorCode !== undefined) {
          emit({ type: "clear-error" });
        }
        return;
      }
    } catch {
      // 存储查询异常时降级走标准创建路径
    }

    // 3. 存储中不存在任何空会话，正常创建新的会话
    try {
      const loaded = await createConversation(currentLocale);
      emit({
        conversation: loaded.conversation,
        messages: loaded.messages,
        type: "conversation-selected",
        ...(loaded.hasMoreHistory ? { hasMoreHistory: true } : {}),
      });
    } catch {
      emit({ errorCode: "CONVERSATION_LIMIT", type: "load-failed" });
    }
  }, [createConversation, emit, nextTimestamp, stopAndWait]);

  const selectConversation = useCallback(
    async (id: string): Promise<void> => {
      await stopAndWait();
      try {
        const conversation = await servicesRef.current.repository.getConversation(id);
        if (conversation === undefined) throw new TypeError("Conversation is missing.");
        // UI 窗口化：切换会话同样只加载最近 windowSize 条，多取 1 条探测更早历史
        const stored = await servicesRef.current.repository.listMessages(id, {
          limit: historyWindowSize + 1,
        });
        const hasMoreHistory = stored.length > historyWindowSize;
        const messages = hasMoreHistory ? stored.slice(1) : stored;
        await servicesRef.current.repository.setLocale(conversation.locale);
        emit({
          conversation,
          messages,
          type: "conversation-selected",
          ...(hasMoreHistory ? { hasMoreHistory: true } : {}),
        });
      } catch {
        emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      }
    },
    [emit, stopAndWait],
  );

  const loadEarlier = useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    const conversation = snapshot.activeConversation;
    const oldest = snapshot.messages[0];
    if (conversation === undefined || oldest === undefined) return;
    try {
      // 排他上界 = 当前窗口最早一条，避免与已加载区间重叠
      const earlier = await servicesRef.current.repository.listMessages(conversation.id, {
        beforeCreatedAt: oldest.createdAt,
        limit: historyLoadStep,
      });
      if (mountedRef.current && stateRef.current.activeConversation?.id === conversation.id) {
        emit({ messages: earlier, type: "load-earlier-loaded" });
      }
    } catch {
      if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
    }
  }, [emit]);

  const setLocale = useCallback(
    async (locale: Locale): Promise<void> => {
      await stopAndWait();
      try {
        await servicesRef.current.repository.setLocale(locale);
        const conversation = stateRef.current.activeConversation;
        if (conversation !== undefined) {
          await servicesRef.current.repository.setConversationLocale(conversation.id, locale);
        }
        emit({ locale, type: "locale-changed" });
      } catch {
        emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      }
    },
    [emit, stopAndWait],
  );

  const setPendingImage = useCallback(
    (image?: StoredImage) => emit({ image, type: "pending-image-changed" }),
    [emit],
  );

  const setOnline = useCallback(
    (online: boolean) => {
      if (!online) void stop();
      emit({ online, type: "connectivity-changed" });
    },
    [emit, stop],
  );

  const updateUserMemory = useCallback(
    async (memory: string): Promise<boolean> => {
      cancelMetadata();
      const normalized = memory.trim();
      try {
        await servicesRef.current.repository.updateUserMemory(normalized);
        if (mountedRef.current) emit({ type: "user-memory-updated", memory: normalized });
        await refreshUserMemoryHistory();
        return true;
      } catch {
        if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        return false;
      }
    },
    [cancelMetadata, emit, refreshUserMemoryHistory],
  );

  const deleteConversation = useCallback(async (id: string): Promise<boolean> => {
    cancelMetadata();
    if (stateRef.current.activeConversation?.id === id) await stop();
    const repository = servicesRef.current.repository;
    if (repository.deleteConversation === undefined) return false;
    try {
      const deletedMemory = await repository.deleteConversation(id);
      const memory = typeof deletedMemory === "string" ? deletedMemory : await repository.getUserMemory();
      if (mountedRef.current) emit({ type: "user-memory-updated", memory });
      await refreshUserMemoryHistory();
      return true;
    } catch {
      if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      return false;
    }
  }, [cancelMetadata, emit, refreshUserMemoryHistory, stop]);

  const undoUserMemoryChange = useCallback(async (revisionId: string): Promise<boolean> => {
    cancelMetadata();
    try {
      const memory = await servicesRef.current.repository.undoUserMemoryChange?.(revisionId);
      if (memory === undefined) return false;
      if (mountedRef.current) emit({ type: "user-memory-updated", memory });
      return true;
    } catch {
      return false;
    } finally {
      await refreshUserMemoryHistory();
    }
  }, [cancelMetadata, emit, refreshUserMemoryHistory]);

  const rememberMessage = useCallback(async (messageId: string): Promise<RememberMessageResult> => {
    const snapshot = stateRef.current;
    const conversation = snapshot.activeConversation;
    const user = snapshot.messages.find((message) => message.id === messageId);
    const repository = servicesRef.current.repository;
    if (!mountedRef.current || conversation === undefined || snapshot.phase === "offline" ||
      snapshot.phase === "streaming" || snapshot.phase === "compressing" ||
      user?.role !== "user" || user.status !== "complete" || !user.text.trim() ||
      repository.rememberMessageMemory === undefined) return "failed";
    if ([...JSON.stringify({ userText: user.text })].length > 4000) return "too-long";
    cancelMetadata();
    const controller = new AbortController();
    metadataControllerRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    let writing = false;
    try {
      const memory = await repository.getUserMemory();
      const conversationMemory = await repository.getConversationMemory?.(conversation.id) ?? memory;
      if (controller.signal.aborted) return timedOut ? "failed" : "cancelled";
      if ([...conversationMemory].length > 2000 || JSON.stringify(conversationMemory).length > 3500) return "too-long";
      const metadata = await generateConversationMetadata({
        conversation, user, assistant: { ...user, role: "assistant", text: "" }, memory: conversationMemory,
        memoryOnly: true, config: activeLlmConfigRef.current,
        streamChat: servicesRef.current.streamChat, signal: controller.signal,
      });
      if (controller.signal.aborted || !mountedRef.current) return timedOut ? "failed" : "cancelled";
      if (metadata === undefined) return "failed";
      if (metadata.memory === null || metadata.memory === conversationMemory) return "unchanged";
      writing = true;
      const applied = await repository.rememberMessageMemory(conversation.id, user.id, memory, metadata.memory, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return timedOut ? "failed" : "cancelled";
      if (applied === undefined) return "failed";
      emit({ type: "user-memory-updated", memory: applied });
      await refreshUserMemoryHistory();
      return "saved";
    } catch {
      if (writing && !controller.signal.aborted) persistenceFailedRef.current = true;
      return controller.signal.aborted && !timedOut ? "cancelled" : "failed";
    } finally {
      clearTimeout(timer);
      if (metadataControllerRef.current === controller) metadataControllerRef.current = undefined;
    }
  }, [cancelMetadata, emit, refreshUserMemoryHistory]);

  const trackedRememberMessage = useCallback(
    (messageId: string) => trackMetadata(rememberMessage(messageId)),
    [rememberMessage, trackMetadata],
  );

  const clearError = useCallback(() => emit({ type: "clear-error" }), [emit]);

  return {
    ...state,
    messages: overlayStreamedText(state),
    clearError,
    prepareForReload,
    newConversation,
    loadEarlier,
    recall,
    regenerate,
    retry,
    selectConversation,
    deleteConversation,
    send,
    compressConversation,
    updateUserMemory,
    userMemoryHistory,
    refreshUserMemoryHistory,
    undoUserMemoryChange,
    rememberMessage: trackedRememberMessage,
    setLocale,
    setOnline,
    setPendingImage,
    stop,
  };
}
