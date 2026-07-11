import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ChatMessage, Conversation, Locale, StoredImage } from "../domain/chat";
import { copyFor } from "../i18n/messages";
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
  now?: () => number;
  id?: () => string;
}

export interface ChatController extends ChatState {
  send(text: string): Promise<void>;
  retry(): Promise<void>;
  stop(): void;
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
  text: string;
  timer?: ReturnType<typeof setTimeout>;
  token: number;
}

const partialPersistenceInterval = 250;

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

export function useChatController(options: ChatControllerOptions): ChatController {
  const servicesRef = useRef<ControllerServices>({
    id: options.id ?? (() => crypto.randomUUID()),
    now: options.now ?? (() => Date.now()),
    repository: options.repository,
    streamChat: options.streamChat ?? streamChatRequest,
  });
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef<ChatState>(initialChatState);
  const activeRef = useRef<ActiveRun | undefined>(undefined);
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
      const greeting: ChatMessage = {
        conversationId: conversation.id,
        createdAt: nextTimestamp(),
        id: servicesRef.current.id(),
        role: "assistant",
        status: "complete",
        text: copyFor(locale).firstGreeting,
      };
      await queueMessage(greeting);
      return { conversation, locale, messages: [greeting] };
    },
    [nextTimestamp, queueMessage],
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
      return {
        conversation: latest,
        locale,
        messages: await servicesRef.current.repository.listMessages(latest.id),
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
      const active = activeRef.current;
      if (active !== undefined) {
        activeRef.current = undefined;
        if (active.timer !== undefined) clearTimeout(active.timer);
        active.controller.abort();
        void queueMessage({
          ...active.assistant,
          status: "stopped",
          text: active.text,
        }).catch(() => undefined);
      }
    };
  }, [createConversation, emit, queueMessage]);

  const makeRequestMessages = useCallback(
    async (messages: ChatMessage[], pendingImage?: StoredImage): Promise<StreamChatMessage[]> => {
      const history = messages.filter(isHistoryMessage).slice(-20);
      const lastIndex = history.length - 1;
      return Promise.all(
        history.map(async (message, index) => {
          const requestMessage: StreamChatMessage = {
            role: message.role,
            text: message.text,
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
    },
    [],
  );

  const finishRun = useCallback(
    async (
      run: ActiveRun,
      status: "complete" | "failed" | "stopped",
      errorCode?: string,
    ): Promise<void> => {
      if (activeRef.current?.token !== run.token) return;
      activeRef.current = undefined;
      if (run.timer !== undefined) clearTimeout(run.timer);
      const message: ChatMessage = { ...run.assistant, status, text: run.text };
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
      await queueMessage(assistant);

      const run: ActiveRun = {
        assistant,
        controller: new AbortController(),
        text: "",
        token: ++runTokenRef.current,
      };
      activeRef.current = run;
      emit({ assistant, type: "send-started", user });

      const schedulePartialPersistence = () => {
        if (run.timer !== undefined || activeRef.current?.token !== run.token) return;
        run.timer = setTimeout(() => {
          run.timer = undefined;
          if (activeRef.current?.token !== run.token) return;
          void queueMessage({
            ...run.assistant,
            status: "streaming",
            text: run.text,
          }).catch(() => undefined);
        }, partialPersistenceInterval);
      };

      try {
        const requestMessages = await makeRequestMessages(history, pendingImage);
        await servicesRef.current.streamChat(
          { locale: stateRef.current.locale, messages: requestMessages },
          {
            onDelta(text) {
              if (activeRef.current?.token !== run.token || text.length === 0) return;
              run.text += text;
              emit({ messageId: run.assistant.id, text, type: "delta" });
              schedulePartialPersistence();
            },
            signal: run.controller.signal,
          },
        );
        await finishRun(run, "complete");
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

  const send = useCallback(
    async (text: string): Promise<void> => {
      const snapshot = stateRef.current;
      if (
        sendingRef.current ||
        snapshot.activeConversation === undefined ||
        snapshot.phase === "loading" ||
        snapshot.phase === "streaming" ||
        snapshot.phase === "offline"
      ) {
        return;
      }

      const normalized = text.trim();
      if (normalized.length === 0 && snapshot.pendingImage === undefined) return;
      sendingRef.current = true;
      try {
        const image =
          snapshot.pendingImage === undefined
            ? undefined
            : { ...snapshot.pendingImage, conversationId: snapshot.activeConversation.id };
        if (image !== undefined) await servicesRef.current.repository.putImage(image);
        const user: ChatMessage = {
          conversationId: snapshot.activeConversation.id,
          createdAt: nextTimestamp(),
          ...(image === undefined ? {} : { imageId: image.id }),
          id: servicesRef.current.id(),
          role: "user",
          status: "complete",
          text: normalized,
        };
        await queueMessage(user);
        await startAssistant([...snapshot.messages, user], user, image);
      } catch {
        if (mountedRef.current) emit({ errorCode: "STORAGE_ERROR", type: "load-failed" });
      } finally {
        sendingRef.current = false;
      }
    },
    [emit, nextTimestamp, queueMessage, startAssistant],
  );

  const retry = useCallback(async (): Promise<void> => {
    const snapshot = stateRef.current;
    if (
      sendingRef.current ||
      snapshot.activeConversation === undefined ||
      snapshot.phase === "loading" ||
      snapshot.phase === "streaming" ||
      snapshot.phase === "offline" ||
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

  const stop = useCallback(() => {
    const run = activeRef.current;
    if (run === undefined) return;
    run.controller.abort();
    void finishRun(run, "stopped");
  }, [finishRun]);

  const stopAndWait = useCallback(async () => {
    const run = activeRef.current;
    if (run === undefined) return;
    run.controller.abort();
    await finishRun(run, "stopped");
  }, [finishRun]);

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
      if (!online) stop();
      emit({ online, type: "connectivity-changed" });
    },
    [emit, stop],
  );

  const clearError = useCallback(() => emit({ type: "clear-error" }), [emit]);

  return {
    ...state,
    clearError,
    newConversation,
    retry,
    selectConversation,
    send,
    setLocale,
    setOnline,
    setPendingImage,
    stop,
  };
}
