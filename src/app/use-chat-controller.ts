import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ChatMessage, ChatSource, Conversation, Locale, StoredImage, TokenUsage } from "../domain/chat";
import type { ActiveLlmConfig } from "../domain/llm";
import type { SkillDefinition } from "../skills";

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
  ): Promise<void>;
  getUserMemory(): Promise<string>;
  updateUserMemory(memory: string): Promise<void>;
  /** 将存储中的会话消息截断为给定前缀（定点删除水位线之后的部分） */
  replaceMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;
  deleteMessagesFrom(conversationId: string, fromCreatedAt: number): Promise<void>;
  putImage(image: StoredImage): Promise<void>;
  getImage(id: string): Promise<StoredImage | undefined>;
  setLocale(locale: Locale): Promise<void>;
  getLocale(): Promise<Locale>;
  setConversationLocale(id: string, locale: Locale): Promise<void>;
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
  now?: () => number;
  id?: () => string;
}

export interface RecalledMessageData {
  text: string;
  imageId?: string;
}

export interface ChatController extends ChatState {
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  stop(): Promise<void>;
  recall(): Promise<RecalledMessageData | undefined>;
  regenerate(messageId?: string): Promise<void>;
  compressConversation(manual?: boolean): Promise<boolean>;
  updateUserMemory(memory: string): Promise<boolean>;
  newConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
  /** 向上翻页：加载当前窗口之前更早的历史消息（UI 窗口化） */
  loadEarlier(): Promise<void>;
  setLocale(locale: Locale): Promise<void>;
  setPendingImage(image?: StoredImage): void;
  setOnline(online: boolean): void;
  clearError(): void;
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

/** 解析压缩请求的双区块输出；模型未按格式输出时整体降级为会话记忆 */
function parseCompressionOutput(text: string): { conversationMemory: string; userProfile?: string } {
  const memoryMatch = text.match(/<conversation_memory>([\s\S]*?)<\/conversation_memory>/i);
  const profileMatch = text.match(/<user_profile>([\s\S]*?)<\/user_profile>/i);
  const conversationMemory = memoryMatch?.[1]?.trim() ?? "";
  if (conversationMemory.length > 0) {
    const userProfile = profileMatch?.[1]?.trim();
    return {
      conversationMemory,
      ...(userProfile !== undefined && userProfile.length > 0 ? { userProfile } : {}),
    };
  }
  return { conversationMemory: text.trim() };
}

/** 压缩指令：要求合并既有记忆并顺带提炼用户长期画像，双区块输出 */
const compressionInstruction: Record<"zh-CN" | "ja-JP", string> = {
  "zh-CN": `请整理以上内容，输出以下两个区块，不要输出其他内容：

<conversation_memory>
合并【已有记忆摘要】与最新对话内容，输出更新后的完整会话记忆，按以下结构组织：
【核心事实】双方确认的重要事实与设定
【用户特征与偏好】彩叶表现出的喜好、习惯与性格特点
【双方约定】互相许下的承诺与约定
【关系与情绪】当前关系状态与情绪脉络
【剧情进展】故事线的关键节点
旧记忆中仍然有效的内容必须保留，不得遗漏。
</conversation_memory>

<user_profile>
从对话中提炼用户「酒寄彩叶」的长期画像（称呼、喜好、重要经历等），与【现有用户画像】合并去重后输出完整版本；没有新增内容时原样输出既有画像。
</user_profile>`,
  "ja-JP": `以上の内容を整理し、次の2つのブロックのみを出力してください：

<conversation_memory>
【既存の記憶要約】と最新の会話を統合し、更新後の完全な会話メモリーを以下の構成で出力してください：
【核心的事実】両者が確認した重要な事実と設定
【ユーザーの特徴と好み】彩葉の好み・習慣・性格
【約束事項】交わした約束
【関係と感情】現在の関係性と感情の流れ
【ストーリーの進展】物語の重要な節目
古い記憶のうち今も有効な内容は必ず残してください。
</conversation_memory>

<user_profile>
会話からユーザー「酒寄彩葉」の長期プロフィール（呼び名、好み、大切な出来事など）を抽出し、【既存のユーザープロフィール】と統合・重複排除した完全版を出力してください。追加情報がない場合は既存のプロフィールをそのまま出力してください。
</user_profile>`,
};

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
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef<ChatState>(initialChatState);
  const activeRef = useRef<ActiveRun | undefined>(undefined);
  const compressControllerRef = useRef<AbortController | undefined>(undefined);
  const initializationRef = useRef<Promise<InitialData> | undefined>(undefined);
  const mountedRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const runTokenRef = useRef(0);
  const sendingRef = useRef(false);
  const lastTimestampRef = useRef(0);

  const nextTimestamp = useCallback(() => {
    const timestamp = Math.max(servicesRef.current.now(), lastTimestampRef.current + 1);
    lastTimestampRef.current = timestamp;
    return timestamp;
  }, []);

  const emit = useCallback((action: ChatAction) => {
    stateRef.current = chatReducer(stateRef.current, action);
    dispatch(action);
  }, []);

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
    persistQueueRef.current = task.catch(() => undefined);
    return task;
  }, []);

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
  }, [createConversation, emit, queueMessage]);

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

      const activeUserMemory = stateRef.current.userMemory;
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

      const activeSummary = overrideSummary ?? stateRef.current.activeConversation?.summary;
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
        await queueMessage(message).catch(() => {
          if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        });
      })();
      return run.finishing;
    },
    [emit, queueMessage],
  );

  const startAssistant = useCallback(
    async (
      history: ChatMessage[],
      user: ChatMessage | undefined,
      pendingImage?: StoredImage,
    ): Promise<void> => {
      const activeConfig = activeLlmConfigRef.current;
      const currentProvider = activeConfig?.provider ?? "stepfun";
      const currentModel = activeConfig?.model ?? "step-3.7-flash";
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
        const result = await servicesRef.current.streamChat(
          {
            locale: stateRef.current.locale,
            messages: requestMessages,
            currentTime,
            ...(activeConfig !== undefined
              ? { provider: activeConfig.provider, apiKey: activeConfig.apiKey, model: activeConfig.model }
              : {}),
            ...(webSearchEnabledRef.current === true ? { webSearch: true } : {}),
            ...(webSearchEnabledRef.current === true && webSearchSmartRef.current === true
              ? { smartSearch: true }
              : {}),
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
    [emit, finishRun, makeRequestMessages, nextTimestamp, queueMessage],
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

      // 增量压缩：只处理压缩边界之后的消息，已压缩区间由摘要取代
      const previousBoundary = snapshot.activeConversation.compressedUpTo;
      const uncompressedCount = countUncompressedMessages(snapshot.messages, previousBoundary);
      if (uncompressedCount <= 1) {
        return false;
      }

      const controller = new AbortController();
      compressControllerRef.current = controller;
      sendingRef.current = true;
      emit({ type: "compress-started" });

      try {
        const conversationId = snapshot.activeConversation.id;
        const summaryPrompt = compressionInstruction[snapshot.locale];

        const existingSummary = snapshot.activeConversation.summary?.trim();
        const hasExistingSummary = Boolean(existingSummary && existingSummary.length > 0);

        const existingUserMemory = snapshot.userMemory?.trim();
        const hasExistingUserMemory = Boolean(
          existingUserMemory && existingUserMemory.length > 0,
        );

        const priorSummaryUser = hasExistingSummary
          ? snapshot.locale === "ja-JP"
            ? `【既存の記憶要約】\n${existingSummary}`
            : `【已有记忆摘要】\n${existingSummary}`
          : "";
        const priorSummaryAssistant = hasExistingSummary
          ? snapshot.locale === "ja-JP"
            ? "（既存の要約を確認しました）"
            : "（已知悉既有摘要）"
          : "";

        const priorMemoryUser = hasExistingUserMemory
          ? snapshot.locale === "ja-JP"
            ? `【既存のユーザープロフィール】\n${existingUserMemory}`
            : `【现有用户画像】\n${existingUserMemory}`
          : "";
        const priorMemoryAssistant = hasExistingUserMemory
          ? snapshot.locale === "ja-JP"
            ? "（既存のプロフィールを確認しました）"
            : "（已知悉现有用户画像）"
          : "";

        const reservedChars =
          [...summaryPrompt].length +
          [...priorSummaryUser].length +
          [...priorSummaryAssistant].length +
          [...priorMemoryUser].length +
          [...priorMemoryAssistant].length;

        const reservedSlots =
          (hasExistingSummary ? 2 : 0) + (hasExistingUserMemory ? 2 : 0) + 1;
        const history = requestHistory(
          snapshot.messages,
          reservedChars,
          maximumRequestMessages - reservedSlots,
          previousBoundary,
        );

        const requestMessages: StreamChatMessage[] = [];
        if (hasExistingSummary) {
          requestMessages.push(
            { role: "user", text: priorSummaryUser },
            { role: "assistant", text: priorSummaryAssistant },
          );
        }
        if (hasExistingUserMemory) {
          requestMessages.push(
            { role: "user", text: priorMemoryUser },
            { role: "assistant", text: priorMemoryAssistant },
          );
        }

        for (const { message, text } of history) {
          requestMessages.push({ role: message.role, text });
        }

        requestMessages.push({ role: "user", text: summaryPrompt });

        const activeConfig = activeLlmConfigRef.current;
        let summaryText = "";

        await servicesRef.current.streamChat(
          {
            locale: snapshot.locale,
            messages: requestMessages,
            mode: "summary",
            ...(activeConfig !== undefined
              ? { provider: activeConfig.provider, apiKey: activeConfig.apiKey, model: activeConfig.model }
              : {}),
          },
          {
            onDelta(text) {
              summaryText += text;
            },
            signal: controller.signal,
          },
        );

        if (controller.signal.aborted) {
          if (mountedRef.current) emit({ type: "clear-error" });
          return false;
        }

        const { conversationMemory, userProfile } = parseCompressionOutput(summaryText);
        if (conversationMemory.length > 0) {
          // 压缩边界推进到最后一条纳入本次摘要的消息；边界只前进不后退
          const lastIncluded = history[history.length - 1];
          const nextBoundary =
            lastIncluded !== undefined
              ? Math.max(lastIncluded.message.createdAt, previousBoundary ?? 0)
              : undefined;
          const nextBoundaryId = lastIncluded?.message.id;

          await servicesRef.current.repository.updateConversationSummary(
            conversationId,
            conversationMemory,
            nextTimestamp(),
            nextBoundary,
            nextBoundaryId,
          );
          if (userProfile !== undefined) {
            await servicesRef.current.repository.updateUserMemory(userProfile);
          }
          if (
            mountedRef.current &&
            stateRef.current.activeConversation?.id === conversationId &&
            !controller.signal.aborted
          ) {
            emit({
              type: "context-compressed",
              summary: conversationMemory,
              ...(nextBoundary !== undefined ? { compressedUpTo: nextBoundary } : {}),
              ...(nextBoundaryId !== undefined ? { compressedUpToId: nextBoundaryId } : {}),
              ...(userProfile !== undefined ? { userMemory: userProfile } : {}),
            });
            return true;
          }
        }
        if (mountedRef.current) emit({ type: "clear-error" });
        return false;
      } catch {
        if (mountedRef.current) emit({ type: "clear-error" });
        return false;
      } finally {
        if (compressControllerRef.current === controller) {
          compressControllerRef.current = undefined;
        }
        sendingRef.current = false;
      }
    },
    [emit, nextTimestamp],
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
      sendingRef.current = true;
        try {
        // 未压缩历史达到阈值时先增量压缩，再发送（为摘要/长期记忆前缀预留槽位）
        if (
          countUncompressedMessages(
            currentMessages,
            snapshot.activeConversation.compressedUpTo,
          ) >= compressionTriggerUncompressedMessages
        ) {
          sendingRef.current = false;
          await compressConversation();
          sendingRef.current = true;

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
        sendingRef.current = false;
      }
    },
    [compressConversation, emit, nextTimestamp, startAssistant],
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
    sendingRef.current = true;
    try {
      await startAssistant(snapshot.messages, undefined);
    } finally {
      sendingRef.current = false;
    }
  }, [startAssistant]);

  const stop = useCallback(async (): Promise<void> => {
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
  }, [emit, finishRun]);

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
        // 水位线定点删除：撤回目标及其后的所有记录（含未加载的窗口外消息），保留区不动
        await servicesRef.current.repository.deleteMessagesFrom(
          conversationId,
          recalledUser.createdAt,
        );
      });
      persistQueueRef.current = task.catch(() => undefined);
      await task;

      if (mountedRef.current) {
        emit({ messages: remainingMessages, type: "messages-reverted" });
      }

      return {
        imageId: recalledUser.imageId,
        text: recalledUser.text,
      };
    } catch {
      if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      return undefined;
    }
  }, [emit]);

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

      sendingRef.current = true;
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
        persistQueueRef.current = task.catch(() => undefined);
        await task;

        if (mountedRef.current) {
          emit({ messages: precedingMessages, type: "messages-reverted" });
        }

        await startAssistant(precedingMessages, undefined);
      } catch {
        if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      } finally {
        sendingRef.current = false;
      }
    },
    [emit, startAssistant],
  );

  const stopAndWait = useCallback(async () => {
    await stop();
  }, [stop]);

  const newConversation = useCallback(async (): Promise<void> => {
    await stopAndWait();
    try {
      const loaded = await createConversation(stateRef.current.locale);
      emit({
        conversation: loaded.conversation,
        messages: loaded.messages,
        type: "conversation-selected",
        ...(loaded.hasMoreHistory ? { hasMoreHistory: true } : {}),
      });
    } catch {
      emit({ errorCode: "CONVERSATION_LIMIT", type: "load-failed" });
    }
  }, [createConversation, emit, stopAndWait]);

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
      const normalized = memory.trim();
      try {
        await servicesRef.current.repository.updateUserMemory(normalized);
        if (mountedRef.current) emit({ type: "user-memory-updated", memory: normalized });
        return true;
      } catch {
        if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
        return false;
      }
    },
    [emit],
  );

  const clearError = useCallback(() => emit({ type: "clear-error" }), [emit]);

  return {
    ...state,
    messages: overlayStreamedText(state),
    clearError,
    newConversation,
    loadEarlier,
    recall,
    regenerate,
    retry,
    selectConversation,
    send,
    compressConversation,
    updateUserMemory,
    setLocale,
    setOnline,
    setPendingImage,
    stop,
  };
}
