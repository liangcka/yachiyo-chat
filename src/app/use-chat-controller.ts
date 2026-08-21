import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ChatMessage, ChatSource, Conversation, Locale, StoredImage } from "../domain/chat";
import type { ActiveLlmConfig } from "../domain/llm";
import type { SkillDefinition } from "../skills";

import {
  ChatClientError,
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
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  putMessage(message: ChatMessage): Promise<void>;
  updateConversationSummary(id: string, summary: string, now?: number): Promise<void>;
  replaceMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;
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
  newConversation(): Promise<void>;
  selectConversation(id: string): Promise<void>;
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
}

interface ActiveRun {
  assistant: ChatMessage;
  controller: AbortController;
  finishing?: Promise<void>;
  preparation: Promise<void>;
  text: string;
  /** 联网搜索返回的参考来源（sources 事件先于 delta 到达），随消息持久化 */
  sources?: ReadonlyArray<ChatSource>;
  timer?: ReturnType<typeof setTimeout>;
  token: number;
}

const partialPersistenceInterval = 250;
const maximumRequestCharacters = 24_000;
const maximumRequestMessageCharacters = 4_000;
const maximumRequestMessages = 20;
const retryableGenerationErrors = new Set([
  "NETWORK_ERROR",
  "PROVIDER_ERROR",
  "SERVICE_UNAVAILABLE",
  "STREAM_ERROR",
]);

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
): Array<{ message: ChatMessage; text: string }> {
  const eligible = messages.filter(isHistoryMessage);
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
      return { conversation, locale, messages: [] };
    },
    [nextTimestamp],
  );

  useEffect(() => {
    mountedRef.current = true;
    let ignored = false;

    initializationRef.current ??= (async () => {
      const locale = await servicesRef.current.repository.getLocale();
      const conversations = await servicesRef.current.repository.listConversations();
      const latest = conversations[0];
      if (latest === undefined) return createConversation(locale);
      lastTimestampRef.current = Math.max(lastTimestampRef.current, latest.updatedAt);
      const storedMessages = await servicesRef.current.repository.listMessages(latest.id);
      const messages = storedMessages.map((message) =>
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

      const activeSummary = overrideSummary ?? stateRef.current.activeConversation?.summary;
      const hasSummary = typeof activeSummary === "string" && activeSummary.trim().length > 0;

      const summaryUserText = hasSummary
        ? stateRef.current.locale === "ja-JP"
          ? `【これまでの会話の記憶・背景】\n${activeSummary.trim()}`
          : `【前情提要 / 历史背景记忆】\n${activeSummary.trim()}`
        : "";
      const summaryAssistantText = hasSummary
        ? stateRef.current.locale === "ja-JP"
          ? "（これまでの経緯と記憶を把握しました。会話を続けます）"
          : "（已记住我们之前的对话与经历，继续交流~）"
        : "";

      const summaryChars = hasSummary
        ? [...summaryUserText].length + [...summaryAssistantText].length
        : 0;

      const reservedPrefixMessages = (hasSkills ? 2 : 0) + (hasSummary ? 2 : 0);
      const maxHistoryMessages = maximumRequestMessages - reservedPrefixMessages;
      const history = requestHistory(
        messages,
        reserveCharacters + summaryChars + skillChars,
        maxHistoryMessages,
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
    ): Promise<void> => {
      if (run.finishing !== undefined) return run.finishing;
      run.finishing = (async () => {
        if (activeRef.current?.token !== run.token) return;
        activeRef.current = undefined;
        if (run.timer !== undefined) clearTimeout(run.timer);
        const message: ChatMessage = {
          ...run.assistant,
          status,
          text: run.text,
          ...(truncated === true ? { truncated: true } : {}),
          ...(run.sources !== undefined ? { sources: run.sources } : {}),
        };
        if (mountedRef.current) {
          if (status === "complete") emit({ messageId: run.assistant.id, type: "completed" });
          else if (status === "stopped") emit({ messageId: run.assistant.id, type: "stopped" });
          else {
            emit({
              errorCode: errorCode ?? "SERVICE_UNAVAILABLE",
              messageId: run.assistant.id,
              type: "failed",
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
      const assistant: ChatMessage = {
        conversationId: history.at(-1)?.conversationId ?? "",
        createdAt: nextTimestamp(),
        id: servicesRef.current.id(),
        role: "assistant",
        status: "streaming",
        text: "",
      };

      const run: ActiveRun = {
        assistant,
        controller: new AbortController(),
        preparation: Promise.resolve(),
        text: "",
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
            ...(run.sources !== undefined ? { sources: run.sources } : {}),
          }).catch(() => undefined);
        }, partialPersistenceInterval);
      };

      try {
        const requestMessages = await makeRequestMessages(history, pendingImage);
        const activeConfig = activeLlmConfigRef.current;
        // 流正常结束但零输出（如推理模型思考耗尽 token 预算）视为可重试失败，
        // 避免空气泡被静默隐藏
        const result = await servicesRef.current.streamChat(
          {
            locale: stateRef.current.locale,
            messages: requestMessages,
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
              emit({ messageId: run.assistant.id, text, type: "delta" });
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

      const eligibleMessages = snapshot.messages.filter(isHistoryMessage);
      if (eligibleMessages.length <= 1 && !snapshot.activeConversation.summary) {
        return false;
      }

      const controller = new AbortController();
      compressControllerRef.current = controller;
      sendingRef.current = true;
      emit({ type: "compress-started" });

      try {
        const conversationId = snapshot.activeConversation.id;
        const summaryPrompt =
          snapshot.locale === "ja-JP"
            ? "以上の会話履歴から重要な情報・設定・約束を要約し、記憶として整理してください。要約のみを出力してください。"
            : "请总结提炼以上对话中的重要事实、用户偏好、约定与核心要点，整理为对话记忆。请直接输出摘要。";

        const existingSummary = snapshot.activeConversation.summary?.trim();
        const hasExistingSummary = Boolean(existingSummary && existingSummary.length > 0);

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

        const reservedChars =
          [...summaryPrompt].length +
          [...priorSummaryUser].length +
          [...priorSummaryAssistant].length;

        // Max history slots = 20 - (hasExistingSummary ? 2 : 0) - 1 (for summaryPrompt)
        const maxHistorySlots = hasExistingSummary ? 17 : 19;
        const history = requestHistory(snapshot.messages, reservedChars, maxHistorySlots);

        const requestMessages: StreamChatMessage[] = [];
        if (hasExistingSummary) {
          requestMessages.push(
            { role: "user", text: priorSummaryUser },
            { role: "assistant", text: priorSummaryAssistant },
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

        const cleanSummary = summaryText.trim();
        if (cleanSummary.length > 0) {
          await servicesRef.current.repository.updateConversationSummary(
            conversationId,
            cleanSummary,
            nextTimestamp(),
          );
          if (
            mountedRef.current &&
            stateRef.current.activeConversation?.id === conversationId &&
            !controller.signal.aborted
          ) {
            emit({ type: "context-compressed", summary: cleanSummary });
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
        if (currentMessages.length >= maximumRequestMessages) {
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
      !retryableGenerationErrors.has(snapshot.errorCode ?? "") ||
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
      active.controller.abort();
    }

    const recalledUser = messages[lastUserIndex];
    if (recalledUser === undefined) return undefined;

    const remainingMessages = messages.slice(0, lastUserIndex);
    const conversationId = snapshot.activeConversation.id;

    try {
      const task = persistQueueRef.current.then(() =>
        servicesRef.current.repository.replaceMessages(conversationId, remainingMessages),
      );
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
        active.controller.abort();
      }

      sendingRef.current = true;
      const conversationId = snapshot.activeConversation.id;

      try {
        const task = persistQueueRef.current.then(() =>
          servicesRef.current.repository.replaceMessages(conversationId, precedingMessages),
        );
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
        const messages = await servicesRef.current.repository.listMessages(id);
        await servicesRef.current.repository.setLocale(conversation.locale);
        emit({ conversation, messages, type: "conversation-selected" });
      } catch {
        emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      }
    },
    [emit, stopAndWait],
  );

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

  const clearError = useCallback(() => emit({ type: "clear-error" }), [emit]);

  return {
    ...state,
    clearError,
    newConversation,
    recall,
    regenerate,
    retry,
    selectConversation,
    send,
    compressConversation,
    setLocale,
    setOnline,
    setPendingImage,
    stop,
  };
}
