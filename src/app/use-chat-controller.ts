import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChatMessage, ChatSource, Conversation, Locale, StoredImage, TokenUsage } from "../domain/chat";
import { isServerManagedModel, type ActiveLlmConfig } from "../domain/llm";
import type { UserMemoryRevision } from "../domain/user-memory";
import type { SkillDefinition } from "../skills";
import {
  ChatClientError,
  isRetryableChatErrorCode,
  streamChat as streamChatRequest,
} from "../services/chat-client";
import {
  chatReducer,
  initialChatState,
  selectVisibleMessages,
  type ChatAction,
  type ChatPhase,
  type ChatState,
} from "./chat-reducer";
import type {
  ChatController,
  ChatControllerOptions,
  ChatRepository,
  RecalledMessageData,
  RememberMessageResult,
  StreamChatFunction,
} from "./chat/contracts";
import {
  claimReusableEmptyConversation,
  historyLoadStep,
  loadMessageWindow,
  type MessageWindow,
} from "./chat/conversation-loading";
import {
  buildRequestMessages,
  buildRequestTiming,
  compressionTriggerUncompressedMessages,
  countUncompressedMessages,
  requestLimits,
} from "./chat/request-context";
import { createStreamBatcher, type StreamBatcher } from "./chat/stream-batcher";
import { generateConversationMetadata } from "./conversation-metadata";
import {
  buildConversationSummaryBatch,
  parseConversationSummary,
  selectConversationSummaryMessages,
} from "./conversation-summary";

export type {
  ChatController,
  ChatControllerOptions,
  ChatRepository,
  RecalledMessageData,
  RememberMessageResult,
  StreamChatFunction,
} from "./chat/contracts";
export { formatClientTimestamp } from "./chat/request-context";

interface ControllerServices {
  repository: ChatRepository;
  streamChat: StreamChatFunction;
  now: () => number;
  id: () => string;
}

interface InitialData extends MessageWindow {
  conversation: Conversation;
  locale: Locale;
  userMemory?: string;
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
const compressionFailureCooldown = 120_000;
const backgroundTaskTimeout = 30_000;
const fallbackProvider = "glm";
const fallbackModel = "glm-4.7-flash";

/** 发起新请求类操作的忙碌判定：加载、生成、压缩或离线期间拒绝。 */
function isRequestBlocked(phase: ChatPhase): boolean {
  return phase === "loading" || phase === "streaming" || phase === "compressing" || phase === "offline";
}

/** ES2022 目标环境（含旧版 Android WebView）不保证提供 Array.prototype.findLastIndex。 */
function lastIndexWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }
  return -1;
}

/** 渲染期最新值的只读镜像：异步流程读取发起时刻之后的最新选项。 */
function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function useChatController(options: ChatControllerOptions): ChatController {
  const servicesRef = useRef<ControllerServices>({
    id: options.id ?? (() => crypto.randomUUID()),
    now: options.now ?? (() => Date.now()),
    repository: options.repository,
    streamChat: options.streamChat ?? streamChatRequest,
  });
  const personalLlmConfig = options.activeLlmConfig !== undefined &&
    !isServerManagedModel(options.activeLlmConfig.provider, options.activeLlmConfig.model)
    ? options.activeLlmConfig
    : undefined;
  const activeLlmConfigRef = useLatestRef<ActiveLlmConfig | undefined>(personalLlmConfig);
  const activeSkillsRef = useLatestRef<readonly SkillDefinition[] | undefined>(options.activeSkills);
  const webSearchEnabledRef = useLatestRef(options.webSearchEnabled ?? false);
  const webSearchSmartRef = useLatestRef(options.webSearchSmart ?? false);
  const multiBubbleRef = useLatestRef(options.multiBubble ?? true);

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
  const streamBatcherRef = useRef<StreamBatcher | undefined>(undefined);

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

  /** 串行写入：排在已入队写入之后执行，失败会阻止应用重载。 */
  const enqueuePersistence = useCallback(<T,>(write: () => Promise<T>): Promise<T> =>
    trackPersistence(persistQueueRef.current.then(write)), [trackPersistence]);

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

  const emitIfMounted = useCallback((action: ChatAction) => {
    if (mountedRef.current) emit(action);
  }, [emit]);

  const reportStorageError = useCallback(() => {
    emitIfMounted({ errorCode: "STORAGE_ERROR", type: "load-failed" });
  }, [emitIfMounted]);

  const cancelMetadata = useCallback(() => {
    metadataGenerationRef.current += 1;
    metadataControllerRef.current?.abort();
    metadataControllerRef.current = undefined;
  }, []);

  const abortCompression = useCallback(() => {
    const compressController = compressControllerRef.current;
    if (compressController === undefined) return;
    compressControllerRef.current = undefined;
    compressController.abort();
    emitIfMounted({ type: "clear-error" });
  }, [emitIfMounted]);

  /** 立即解除当前生成与其流式缓冲；调用方负责决定是否持久化中断结果。 */
  const detachActiveRun = useCallback((): ActiveRun | undefined => {
    const active = activeRef.current;
    if (active === undefined) return undefined;
    activeRef.current = undefined;
    if (active.timer !== undefined) clearTimeout(active.timer);
    streamBatcherRef.current?.flush();
    active.controller.abort();
    return active;
  }, []);

  /** 撤回/重生成前清空一切后台任务，避免旧结果在截断后回写。 */
  const interruptBackgroundWork = useCallback(() => {
    cancelMetadata();
    abortCompression();
    detachActiveRun();
  }, [abortCompression, cancelMetadata, detachActiveRun]);

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

  /** 后台整理任务的独占控制器：同一时刻只保留一个，超时自动中止。 */
  const beginBackgroundTask = useCallback(() => {
    cancelMetadata();
    const controller = new AbortController();
    metadataControllerRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, backgroundTaskTimeout);
    return {
      controller,
      timedOut: () => timedOut,
      finish: () => {
        clearTimeout(timer);
        if (metadataControllerRef.current === controller) metadataControllerRef.current = undefined;
      },
    };
  }, [cancelMetadata]);

  const updateMetadata = useCallback(async (assistant: ChatMessage): Promise<void> => {
    const snapshot = stateRef.current;
    const conversation = snapshot.activeConversation;
    const user = [...snapshot.messages].reverse().find((message) => message.role === "user");
    const repository = servicesRef.current.repository;
    if (!mountedRef.current || conversation?.id !== assistant.conversationId || user === undefined ||
      repository.applyConversationMetadata === undefined) return;
    const task = beginBackgroundTask();
    const { signal } = task.controller;
    const config = activeLlmConfigRef.current;
    let writing = false;
    try {
      const memory = await repository.getUserMemory();
      const conversationMemory = await repository.getConversationMemory?.(conversation.id) ?? memory;
      if (signal.aborted) return;
      const metadata = await generateConversationMetadata({
        conversation, user, assistant, memory: conversationMemory, config,
        streamChat: servicesRef.current.streamChat,
        signal,
      });
      if (metadata === undefined || signal.aborted || !mountedRef.current) return;
      writing = true;
      const applied = await repository.applyConversationMetadata(
        conversation.id, assistant.id, memory, metadata, signal,
      );
      if (signal.aborted || !mountedRef.current) return;
      if (applied.conversation !== undefined) {
        emit({ type: "conversation-metadata-updated", conversation: applied.conversation });
      }
      if (applied.memory !== undefined) emit({ type: "user-memory-updated", memory: applied.memory });
    } catch {
      if (writing && !signal.aborted) persistenceFailedRef.current = true;
      // 后台整理失败保留已保存内容，下一次完整对话可重试。
    } finally {
      task.finish();
    }
  }, [activeLlmConfigRef, beginBackgroundTask, emit]);

  useEffect(() => {
    const batcher = createStreamBatcher(emit);
    streamBatcherRef.current = batcher;
    return () => {
      batcher.flush();
      if (streamBatcherRef.current === batcher) streamBatcherRef.current = undefined;
    };
  }, [emit]);

  const queueMessage = useCallback(
    (message: ChatMessage): Promise<void> =>
      enqueuePersistence(() => servicesRef.current.repository.putMessage(message)),
    [enqueuePersistence],
  );

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
      const repository = servicesRef.current.repository;
      const [locale, conversations, userMemory] = await Promise.all([
        repository.getLocale(),
        repository.listConversations(),
        repository.getUserMemory().catch(() => ""),
      ]);
      const latest = conversations[0];
      if (latest === undefined) {
        return { ...(await createConversation(locale)), userMemory };
      }
      lastTimestampRef.current = Math.max(lastTimestampRef.current, latest.updatedAt);
      const window = await loadMessageWindow(repository, latest.id);
      // 上次异常退出残留的 streaming 消息按中断处理并回写
      const messages = window.messages.map((message) =>
        message.status === "streaming" ? { ...message, status: "stopped" as const } : message,
      );
      for (let index = 0; index < messages.length; index += 1) {
        if (messages[index] !== window.messages[index]) await queueMessage(messages[index]!);
      }
      if (locale !== latest.locale) await repository.setLocale(latest.locale);
      return {
        conversation: latest,
        locale: latest.locale,
        messages,
        userMemory,
        hasMoreHistory: window.hasMoreHistory,
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
      abortCompression();
      const active = detachActiveRun();
      if (active !== undefined) {
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
  }, [abortCompression, cancelMetadata, createConversation, detachActiveRun, emit, queueMessage]);

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
        if (status === "complete") {
          emitIfMounted({ messageId: run.assistant.id, type: "completed", usage: finalUsage, latencyMs });
        } else if (status === "stopped") {
          emitIfMounted({ messageId: run.assistant.id, type: "stopped", latencyMs });
        } else {
          emitIfMounted({
            errorCode: errorCode ?? "SERVICE_UNAVAILABLE",
            messageId: run.assistant.id,
            type: "failed",
            latencyMs,
          });
        }
        let persisted = true;
        await queueMessage(message).catch(() => {
          persisted = false;
          reportStorageError();
        });
        if (persisted && status === "complete" && truncated !== true && !run.controller.signal.aborted &&
          metadataGenerationRef.current === run.metadataGeneration) {
          void trackMetadata(updateMetadata(message));
        }
      })();
      return run.finishing;
    },
    [emitIfMounted, queueMessage, reportStorageError, trackMetadata, updateMetadata],
  );

  const startAssistant = useCallback(
    async (
      history: ChatMessage[],
      user: ChatMessage | undefined,
      pendingImage?: StoredImage,
    ): Promise<void> => {
      cancelMetadata();
      const activeConfig = activeLlmConfigRef.current;
      const currentProvider = activeConfig?.provider ?? fallbackProvider;
      const currentModel = activeConfig?.model ?? fallbackModel;
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
      const isCurrentRun = () => activeRef.current?.token === run.token;
      if (!isCurrentRun()) return;
      if (run.controller.signal.aborted) {
        await finishRun(run, "stopped");
        return;
      }

      const schedulePartialPersistence = () => {
        if (run.timer !== undefined || !isCurrentRun()) return;
        run.timer = setTimeout(() => {
          run.timer = undefined;
          if (!isCurrentRun()) return;
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
        const snapshot = stateRef.current;
        const requestMessages = await buildRequestMessages({
          messages: history,
          locale: snapshot.locale,
          skills: activeSkillsRef.current ?? [],
          userMemory: snapshot.userMemory,
          summary: snapshot.activeConversation?.summary,
          compressedUpTo: snapshot.activeConversation?.compressedUpTo,
          pendingImage,
          getImage: (id) => servicesRef.current.repository.getImage(id),
        });
        const timing = buildRequestTiming(history, servicesRef.current.now(), stateRef.current.locale);
        const webSearch = webSearchEnabledRef.current;

        const result = await servicesRef.current.streamChat(
          {
            locale: stateRef.current.locale,
            messages: requestMessages,
            ...timing,
            ...(activeConfig !== undefined
              ? { provider: activeConfig.provider, apiKey: activeConfig.apiKey, model: activeConfig.model }
              : {}),
            ...(webSearch ? { webSearch: true } : {}),
            ...(webSearch && webSearchSmartRef.current ? { smartSearch: true } : {}),
            ...(multiBubbleRef.current === false ? { multiBubble: false } : {}),
          },
          {
            onDelta(text) {
              if (!isCurrentRun() || text.length === 0) return;
              run.text += text;
              streamBatcherRef.current?.push({ messageId: run.assistant.id, text, type: "delta" });
              schedulePartialPersistence();
            },
            onThought(text) {
              if (!isCurrentRun() || text.length === 0) return;
              run.thought = (run.thought ?? "") + text;
              streamBatcherRef.current?.push({
                messageId: run.assistant.id,
                text,
                type: "thought-delta",
              });
              schedulePartialPersistence();
            },
            onSources(sources) {
              if (!isCurrentRun() || sources.length === 0) return;
              run.sources = sources;
              emit({ messageId: run.assistant.id, sources, type: "sources-received" });
              schedulePartialPersistence();
            },
            signal: run.controller.signal,
          },
        );
        // 流正常结束但零输出（如推理模型思考耗尽 token 预算）视为可重试失败，
        // 避免空气泡被静默隐藏
        const empty = run.text.length === 0;
        await finishRun(
          run,
          empty ? "failed" : "complete",
          empty ? "PROVIDER_ERROR" : undefined,
          empty ? undefined : result.truncated,
          result.usage,
        );
      } catch (error) {
        if (!isCurrentRun()) return;
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
    [activeLlmConfigRef, activeSkillsRef, cancelMetadata, emit, finishRun, multiBubbleRef, nextTimestamp,
      queueMessage, webSearchEnabledRef, webSearchSmartRef],
  );

  const compressConversation = useCallback(
    async (): Promise<boolean> => {
      const snapshot = stateRef.current;
      if (sendingRef.current || snapshot.activeConversation === undefined || isRequestBlocked(snapshot.phase)) {
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
            requestLimits,
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
    [activeLlmConfigRef, emit, nextTimestamp, setSending],
  );

  /** 未压缩历史达到阈值且不在失败冷却期时，发送前先增量压缩（为摘要/长期记忆前缀预留槽位）。 */
  const compressBeforeSendIfNeeded = useCallback(async (snapshot: ChatState): Promise<void> => {
    const lastAttempt = lastCompressionAttemptRef.current;
    const coolingDown = lastAttempt.failed &&
      servicesRef.current.now() - lastAttempt.timestamp < compressionFailureCooldown;
    if (coolingDown || countUncompressedMessages(
      snapshot.messages,
      snapshot.activeConversation?.compressedUpTo,
    ) < compressionTriggerUncompressedMessages) return;

    setSending(false);
    const success = await compressConversation();
    lastCompressionAttemptRef.current = {
      failed: !success,
      timestamp: servicesRef.current.now(),
    };
    setSending(true);
  }, [compressConversation, setSending]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const snapshot = stateRef.current;
      if (sendingRef.current || snapshot.activeConversation === undefined || isRequestBlocked(snapshot.phase)) {
        return;
      }

      const normalized = text.trim();
      if (normalized.length === 0 && snapshot.pendingImage === undefined) return;

      const targetConversationId = snapshot.activeConversation.id;
      setSending(true);
      try {
        await compressBeforeSendIfNeeded(snapshot);

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
        await startAssistant([...currentSnapshot.messages, user], user, image);
      } catch {
        reportStorageError();
      } finally {
        setSending(false);
      }
    },
    [compressBeforeSendIfNeeded, nextTimestamp, reportStorageError, setSending, startAssistant],
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
    abortCompression();
    const run = activeRef.current;
    if (run === undefined) return;
    run.controller.abort();
    await run.preparation.catch(() => undefined);
    await finishRun(run, "stopped");
  }, [abortCompression, cancelMetadata, finishRun]);

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
    const lastUserIndex = lastIndexWhere(messages, (message) => message.role === "user");
    const recalledUser = messages[lastUserIndex];
    if (recalledUser === undefined) return undefined;

    interruptBackgroundWork();

    const remainingMessages = messages.slice(0, lastUserIndex);
    const conversationId = snapshot.activeConversation.id;

    try {
      const memory = await enqueuePersistence(async () => {
        const repository = servicesRef.current.repository;
        if (repository.recallMessagesFrom !== undefined) {
          return repository.recallMessagesFrom(conversationId, recalledUser.createdAt);
        }
        await repository.deleteMessagesFrom(conversationId, recalledUser.createdAt);
        return undefined;
      });

      if (memory !== undefined) emitIfMounted({ type: "user-memory-updated", memory });
      emitIfMounted({ messages: remainingMessages, fromCreatedAt: recalledUser.createdAt, type: "messages-reverted" });

      return {
        imageId: recalledUser.imageId,
        text: recalledUser.text,
      };
    } catch {
      reportStorageError();
      return undefined;
    }
  }, [emitIfMounted, enqueuePersistence, interruptBackgroundWork, reportStorageError]);

  const regenerate = useCallback(
    async (messageId?: string): Promise<void> => {
      const snapshot = stateRef.current;
      if (sendingRef.current || snapshot.activeConversation === undefined || isRequestBlocked(snapshot.phase)) {
        return;
      }

      const messages = snapshot.messages;
      const targetIndex = messageId !== undefined
        ? messages.findIndex((message) => message.id === messageId && message.role === "assistant")
        : lastIndexWhere(messages, (message) => message.role === "assistant");
      // 水位线 = 被重生成的 assistant 消息；它及其后的所有记录（含窗口外）定点删除
      const targetMessage = messages[targetIndex];
      if (targetMessage === undefined) return;

      const precedingMessages = messages.slice(0, targetIndex);
      if (!precedingMessages.some((message) => message.role === "user")) return;

      interruptBackgroundWork();
      setSending(true);
      const conversationId = snapshot.activeConversation.id;

      try {
        await enqueuePersistence(() =>
          servicesRef.current.repository.deleteMessagesFrom(conversationId, targetMessage.createdAt),
        );
        emitIfMounted({ messages: precedingMessages, fromCreatedAt: targetMessage.createdAt, type: "messages-reverted" });
        await startAssistant(precedingMessages, undefined);
      } catch {
        reportStorageError();
      } finally {
        setSending(false);
      }
    },
    [emitIfMounted, enqueuePersistence, interruptBackgroundWork, reportStorageError, setSending, startAssistant],
  );

  /** 切换到已有/新建会话时丢弃上一会话的待发送图片与错误提示。 */
  const clearTransientState = useCallback(() => {
    if (stateRef.current.pendingImage !== undefined) {
      emit({ type: "pending-image-changed", image: undefined });
    }
    if (stateRef.current.errorCode !== undefined) {
      emit({ type: "clear-error" });
    }
  }, [emit]);

  const newConversation = useCallback(async (): Promise<void> => {
    await stop();
    const repository = servicesRef.current.repository;
    const currentActive = stateRef.current.activeConversation;
    const currentLocale = stateRef.current.locale;

    // 1. 当前会话本身就是空会话且仍存在于存储中时，直接停留在当前会话
    if (
      currentActive !== undefined &&
      stateRef.current.messages.length === 0 &&
      !stateRef.current.hasMoreHistory
    ) {
      try {
        if (await repository.getConversation(currentActive.id) !== undefined) {
          clearTransientState();
          return;
        }
      } catch {
        // 存储查询异常时降级走后续流程
      }
    }

    // 2. 复用存储中已有的其他未使用空会话，避免产生多个空会话
    try {
      const reusable = await claimReusableEmptyConversation(repository, currentActive?.id);
      if (reusable !== undefined) {
        const now = nextTimestamp();
        await repository.touchConversation?.(reusable.id, now);
        if (reusable.locale !== currentLocale) {
          await repository.setConversationLocale(reusable.id, currentLocale);
        }
        await repository.setLocale(currentLocale);
        emit({
          conversation: {
            ...reusable,
            locale: currentLocale,
            title: currentLocale === "ja-JP" ? "新しい会話" : "新的对话",
            updatedAt: now,
          },
          messages: [],
          type: "conversation-selected",
        });
        clearTransientState();
        return;
      }
    } catch {
      // 存储查询异常时降级走标准创建路径
    }

    // 3. 不存在可复用的空会话，正常创建
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
  }, [clearTransientState, createConversation, emit, nextTimestamp, stop]);

  const selectConversation = useCallback(
    async (id: string): Promise<void> => {
      await stop();
      try {
        const repository = servicesRef.current.repository;
        const conversation = await repository.getConversation(id);
        if (conversation === undefined) throw new TypeError("Conversation is missing.");
        const window = await loadMessageWindow(repository, id);
        await repository.setLocale(conversation.locale);
        emit({
          conversation,
          messages: window.messages,
          type: "conversation-selected",
          ...(window.hasMoreHistory ? { hasMoreHistory: true } : {}),
        });
      } catch {
        emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      }
    },
    [emit, stop],
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
      reportStorageError();
    }
  }, [emit, reportStorageError]);

  const setLocale = useCallback(
    async (locale: Locale): Promise<void> => {
      await stop();
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
    [emit, stop],
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
        emitIfMounted({ type: "user-memory-updated", memory: normalized });
        await refreshUserMemoryHistory();
        return true;
      } catch {
        reportStorageError();
        return false;
      }
    },
    [cancelMetadata, emitIfMounted, refreshUserMemoryHistory, reportStorageError],
  );

  const deleteConversation = useCallback(async (id: string): Promise<boolean> => {
    cancelMetadata();
    if (stateRef.current.activeConversation?.id === id) await stop();
    const repository = servicesRef.current.repository;
    if (repository.deleteConversation === undefined) return false;
    try {
      const deletedMemory = await repository.deleteConversation(id);
      const memory = typeof deletedMemory === "string" ? deletedMemory : await repository.getUserMemory();
      emitIfMounted({ type: "user-memory-updated", memory });
      await refreshUserMemoryHistory();
      return true;
    } catch {
      reportStorageError();
      return false;
    }
  }, [cancelMetadata, emitIfMounted, refreshUserMemoryHistory, reportStorageError, stop]);

  const undoUserMemoryChange = useCallback(async (revisionId: string): Promise<boolean> => {
    cancelMetadata();
    try {
      const memory = await servicesRef.current.repository.undoUserMemoryChange?.(revisionId);
      if (memory === undefined) return false;
      emitIfMounted({ type: "user-memory-updated", memory });
      return true;
    } catch {
      return false;
    } finally {
      await refreshUserMemoryHistory();
    }
  }, [cancelMetadata, emitIfMounted, refreshUserMemoryHistory]);

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
    const task = beginBackgroundTask();
    const { signal } = task.controller;
    const interrupted = (): RememberMessageResult => task.timedOut() ? "failed" : "cancelled";
    let writing = false;
    try {
      const memory = await repository.getUserMemory();
      const conversationMemory = await repository.getConversationMemory?.(conversation.id) ?? memory;
      if (signal.aborted) return interrupted();
      if ([...conversationMemory].length > 2000 || JSON.stringify(conversationMemory).length > 3500) return "too-long";
      const metadata = await generateConversationMetadata({
        conversation, user, assistant: { ...user, role: "assistant", text: "" }, memory: conversationMemory,
        memoryOnly: true, config: activeLlmConfigRef.current,
        streamChat: servicesRef.current.streamChat, signal,
      });
      if (signal.aborted || !mountedRef.current) return interrupted();
      if (metadata === undefined) return "failed";
      if (metadata.memory === null || metadata.memory === conversationMemory) return "unchanged";
      writing = true;
      const applied = await repository.rememberMessageMemory(conversation.id, user.id, memory, metadata.memory, signal);
      if (signal.aborted || !mountedRef.current) return interrupted();
      if (applied === undefined) return "failed";
      emit({ type: "user-memory-updated", memory: applied });
      await refreshUserMemoryHistory();
      return "saved";
    } catch {
      if (writing && !signal.aborted) persistenceFailedRef.current = true;
      return signal.aborted && !task.timedOut() ? "cancelled" : "failed";
    } finally {
      task.finish();
    }
  }, [activeLlmConfigRef, beginBackgroundTask, emit, refreshUserMemoryHistory]);

  const trackedRememberMessage = useCallback(
    (messageId: string) => trackMetadata(rememberMessage(messageId)),
    [rememberMessage, trackMetadata],
  );

  const clearError = useCallback(() => emit({ type: "clear-error" }), [emit]);

  return {
    ...state,
    messages: selectVisibleMessages(state),
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
