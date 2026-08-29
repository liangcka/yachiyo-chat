import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useChatController, type ChatRepository, type StreamChatFunction } from "./app/use-chat-controller";
import { AccessGate } from "./components/AccessGate";
import { Composer } from "./components/Composer";
import { ControlDock } from "./components/ControlDock";
import { ConversationView } from "./components/ConversationView";
import { HistoryPanel } from "./components/HistoryPanel";
import { LlmSettingsPanel, type LlmProviderEntry } from "./components/LlmSettingsPanel";
import { MenuDrawer } from "./components/MenuDrawer";
import { SkillsPanel } from "./components/SkillsPanel";
import { UserMemoryPanel } from "./components/UserMemoryPanel";
import { StarfieldCanvas } from "./components/StarfieldCanvas";
import { ToastRegion } from "./components/ToastRegion";
import { TopControls } from "./components/TopControls";
import { ConversationRepository } from "./data/conversation-repository";
import { YachiyoDatabase } from "./data/db";
import type { Conversation, Locale, StoredImage } from "./domain/chat";
import { PROVIDER_METADATA, type ActiveLlmConfig, type ProviderId } from "./domain/llm";
import {
  ImageProcessingError,
  processImage,
  type ImageProcessingErrorCode,
  type ProcessedImage,
} from "./features/capture/image-processor";
import { copyFor, type UiCopy } from "./i18n/messages";
import { UpdatePrompt } from "./pwa/UpdatePrompt";
import { usePwaUpdate } from "./pwa/use-pwa-update";
import { useAndroidBack } from "./app/use-android-back";
import { useOnlineStatus } from "./pwa/use-online-status";
import { clearWebCaches } from "./services/api-origins";
import { isNativeApp } from "./services/app-platform";
import { isRetryableChatErrorCode, streamChat } from "./services/chat-client";
import { LlmSettingsService } from "./services/llm-settings";
import { SessionClient } from "./services/session-client";
import { SkillSettingsService } from "./services/skill-settings";
import { WebSearchSettingsService, defaultWebSearchSettings, type WebSearchSettings } from "./services/web-search-settings";
import { SKILLS } from "./skills";

export interface AppRepository extends ChatRepository {
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  clearAll(): Promise<void>;
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

export interface AppProps {
  services?: AppServices;
}

const productionDatabase = new YachiyoDatabase();
const productionLlmService = new LlmSettingsService(productionDatabase);
const productionSkillService = new SkillSettingsService(productionDatabase);
const productionWebSearchService = new WebSearchSettingsService(productionDatabase);
const productionServices: AppServices = {
  processImage,
  repository: new ConversationRepository(productionDatabase),
  session: new SessionClient(),
  streamChat,
  llmSettings: productionLlmService,
  skillSettings: productionSkillService,
  webSearchSettings: productionWebSearchService,
};

interface ToastState {
  id: number;
  message: string;
  tone: "info" | "error";
}

type AuthenticationState = "checking" | "authenticated" | "unauthenticated";

function imageErrorMessage(code: ImageProcessingErrorCode, copy: UiCopy): string {
  if (code === "IMAGE_INVALID") return copy.imageInvalid;
  if (code === "IMAGE_TOO_LARGE") return copy.imageTooLarge;
  return copy.genericFailure;
}

function controllerErrorMessage(code: string, copy: UiCopy): string {
  if (code === "DAILY_QUOTA_EXCEEDED") return copy.quotaReached;
  if (code === "SESSION_REQUIRED") return copy.sessionExpired;
  if (code === "NETWORK_ERROR") return copy.offline;
  if (code === "CONVERSATION_LIMIT") return copy.conversationLimit;
  if (code === "STORAGE_ERROR") return copy.storageFull;
  return copy.genericFailure;
}

export function App({ services }: AppProps) {
  const activeServices = services ?? productionServices;
  const llmService = activeServices.llmSettings ?? productionLlmService;
  const skillService = activeServices.skillSettings ?? productionSkillService;
  const webSearchService = activeServices.webSearchSettings ?? productionWebSearchService;
  const { isOnline } = useOnlineStatus();
  const pwa = usePwaUpdate();
  const [authentication, setAuthentication] = useState<AuthenticationState>(() =>
    navigator.onLine ? "checking" : "authenticated",
  );
  const [composerValue, setComposerValue] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [imageUrls, setImageUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [llmActiveProvider, setLlmActiveProvider] = useState<ProviderId>();
  const [llmEntries, setLlmEntries] = useState<readonly LlmProviderEntry[]>([]);
  const [llmOpen, setLlmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string>();
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [webSearchSettings, setWebSearchSettings] = useState<WebSearchSettings>(defaultWebSearchSettings);
  const [toast, setToast] = useState<ToastState>();

  const activeLlmConfig = useMemo<ActiveLlmConfig | undefined>(() => {
    if (llmActiveProvider === undefined) return undefined;
    const entry = llmEntries.find((item) => item.provider === llmActiveProvider);
    if (entry === undefined) return undefined;
    return {
      provider: entry.provider,
      apiKey: entry.apiKey,
      model: entry.model,
    };
  }, [llmActiveProvider, llmEntries]);

  const activeSkills = useMemo(
    () => SKILLS.filter((skill) => activeSkillIds.includes(skill.id)),
    [activeSkillIds],
  );

  const controller = useChatController({
    repository: activeServices.repository,
    streamChat: activeServices.streamChat,
    activeLlmConfig,
    activeSkills,
    webSearchEnabled: webSearchSettings.enabled,
    webSearchSmart: webSearchSettings.smart,
  });
  const setControllerOnline = controller.setOnline;
  const copy = copyFor(controller.locale);
  const handledErrorRef = useRef<string | undefined>(undefined);
  const toastSequenceRef = useRef(0);

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = controller.locale;
    return () => {
      document.documentElement.lang = previousLanguage;
    };
  }, [controller.locale]);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "info") => {
    setToast({ id: ++toastSequenceRef.current, message, tone });
  }, []);
  const showSessionFailure = useEffectEvent(() => showToast(copy.genericFailure, "error"));
  // APK 原生壳：返回键先关弹层，2 秒内再按一次才退出
  useAndroidBack(
    () => {
      if (llmOpen) {
        setLlmOpen(false);
        return true;
      }
      if (skillsOpen) {
        setSkillsOpen(false);
        return true;
      }
      if (historyOpen) {
        setHistoryOpen(false);
        return true;
      }
      if (menuOpen) {
        setMenuOpen(false);
        return true;
      }
      return false;
    },
    () => showToast(copy.exitHint),
  );
  const readLlmSettings = useCallback(async () => {
    const [records, active] = await Promise.all([
      llmService.list(),
      llmService.getActiveProvider(),
    ]);
    return {
      active,
      entries: records.map((record) => ({
        provider: record.provider,
        apiKey: record.apiKey,
        model: record.model,
      })),
    };
  }, [llmService]);

  const syncWebSearchSettings = useCallback(async () => {
    const webSearch = await webSearchService
      .getWebSearchSettings()
      .catch(() => defaultWebSearchSettings);
    setWebSearchSettings(webSearch);
    return webSearch;
  }, [webSearchService]);

  useEffect(() => {
    if (!isOnline) {
      const timeout = setTimeout(() => {
        setAuthentication((current) => (current === "checking" ? "authenticated" : current));
      }, 0);
      return () => clearTimeout(timeout);
    }
    const abortController = new AbortController();
    let cancelled = false;
    void activeServices.session
      .check(abortController.signal)
      .then(async (authenticated) => {
        let llmSettings: Awaited<ReturnType<typeof readLlmSettings>> | undefined;
        if (authenticated) {
          try {
            llmSettings = await readLlmSettings();
          } catch {
            if (!cancelled) showSessionFailure();
          }
          setActiveSkillIds(await skillService.getActiveSkillIds().catch(() => []));
          if (!cancelled) {
            await syncWebSearchSettings();
          }
        }
        if (cancelled) return;
        if (llmSettings !== undefined) {
          setLlmEntries(llmSettings.entries);
          setLlmActiveProvider(llmSettings.active);
        }
        setAuthentication(authenticated ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (!cancelled) {
          setAuthentication("unauthenticated");
          showSessionFailure();
        }
      });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [activeServices, isOnline, readLlmSettings, skillService, syncWebSearchSettings]);

  useEffect(() => {
    const timeout = setTimeout(() => setControllerOnline(isOnline), 0);
    return () => clearTimeout(timeout);
  }, [isOnline, setControllerOnline]);

  // 原生壳启动自愈：清掉旧版 APK 可能残留的 Service Worker 与缓存，防止脏缓存劫持请求。
  // 仅原生壳执行——网页 PWA 的离线缓存不能在每次启动时清空。
  useEffect(() => {
    if (isNativeApp()) void clearWebCaches();
  }, []);

  // 移动端与软键盘适配：实时同步 visualViewport 高度至 CSS 变量
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;

    const handleViewportChange = () => {
      const height = vv.height;
      document.documentElement.style.setProperty("--visual-viewport-height", `${height}px`);
    };

    handleViewportChange();
    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);

    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
      document.documentElement.style.removeProperty("--visual-viewport-height");
    };
  }, []);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bottomEl = chatBottomRef.current;
    if (!bottomEl || typeof ResizeObserver === "undefined") return;

    const updateHeight = () => {
      const height = bottomEl.getBoundingClientRect().height;
      if (height > 0) {
        document.documentElement.style.setProperty("--chat-bottom-height", `${height + 20}px`);
      }
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bottomEl);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--chat-bottom-height");
    };
  }, [authentication]);

  useEffect(() => {
    if (toast === undefined) return;
    const timeout = setTimeout(() => setToast(undefined), 5_200);
    return () => clearTimeout(timeout);
  }, [toast]);

  const refreshHistory = useCallback(async () => {
    try {
      setConversations(await activeServices.repository.listConversations());
    } catch {
      showToast(copy.storageFull, "error");
    }
  }, [activeServices, copy.storageFull, showToast]);

  const refreshLlm = useCallback(async () => {
    try {
      const llmSettings = await readLlmSettings();
      setLlmEntries(llmSettings.entries);
      setLlmActiveProvider(llmSettings.active);
    } catch {
      showToast(copy.genericFailure, "error");
    }
  }, [copy.genericFailure, readLlmSettings, showToast]);

  const openLlmSettings = useCallback(async () => {
    await refreshLlm();
    setLlmOpen(true);
  }, [refreshLlm]);

  const handleLlmSave = useCallback(
    async (provider: ProviderId, apiKey: string, model: string) => {
      await llmService.saveProvider(provider, apiKey, model);
      await refreshLlm();
    },
    [llmService, refreshLlm],
  );

  const handleLlmClear = useCallback(
    async (provider: ProviderId) => {
      await llmService.clear(provider);
      await refreshLlm();
    },
    [llmService, refreshLlm],
  );

  const handleLlmActivate = useCallback(
    async (provider: ProviderId) => {
      await llmService.setActiveProvider(provider);
      setLlmActiveProvider(provider);
    },
    [llmService],
  );

  const handleSkillToggle = useCallback(
    async (id: string, next: boolean) => {
      setActiveSkillIds((current) => {
        const updated = next
          ? [...new Set([...current, id])]
          : current.filter((skillId) => skillId !== id);
        void skillService.setActiveSkillIds(updated).catch(() => undefined);
        return updated;
      });
    },
    [skillService],
  );

  const handleWebSearchSettingsChange = useCallback(
    (partial: Partial<WebSearchSettings>) => {
      setWebSearchSettings((current) => {
        const next = { ...current, ...partial };
        void webSearchService.set(next).catch(() => undefined);
        return next;
      });
    },
    [webSearchService],
  );

  useEffect(() => {
    if (authentication !== "authenticated") return;
    let cancelled = false;
    void activeServices.repository.listConversations().then((items) => {
      if (!cancelled) setConversations(items);
    });
    return () => {
      cancelled = true;
    };
  }, [activeServices, authentication, controller.activeConversation?.id]);

  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  // 稳定签名：只有 imageId 集合变化时才触发 Blob 加载 effect，
  // 流式期间 messages 每帧变化不再引起全量 diff
  const messageImageIdsKey = useMemo(
    () =>
      controller.messages.flatMap(({ imageId }) => (imageId === undefined ? [] : [imageId]))
        .sort()
        .join("\n"),
    [controller.messages],
  );
  const messageImageIds = useMemo(() => {
    const key = messageImageIdsKey;
    return key.length === 0 ? [] : key.split("\n");
  }, [messageImageIdsKey]);

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") {
      return;
    }
    let cancelled = false;
    const missingIds = messageImageIds.filter((id) => !blobUrlsRef.current.has(id));

    if (missingIds.length > 0) {
      const loadImages = async (retryCount = 0) => {
        const entries = await Promise.all(
          missingIds.map(async (id) => {
            if (blobUrlsRef.current.has(id)) return [id, blobUrlsRef.current.get(id)!] as const;
            const image = await activeServices.repository.getImage(id);
            if (image === undefined) return undefined;
            const url = URL.createObjectURL(image.blob);
            blobUrlsRef.current.set(id, url);
            return [id, url] as const;
          }),
        );
        if (!cancelled && entries.some((entry) => entry !== undefined)) {
          setImageUrls(new Map(blobUrlsRef.current));
        }
        const stillMissing = missingIds.filter((id) => !blobUrlsRef.current.has(id));
        if (!cancelled && stillMissing.length > 0 && retryCount < 3) {
          setTimeout(() => {
            if (!cancelled) void loadImages(retryCount + 1);
          }, 150 * (retryCount + 1));
        }
      };
      void loadImages();
    }

    return () => {
      cancelled = true;
    };
  }, [activeServices, messageImageIds]);

  useEffect(() => {
    const cache = blobUrlsRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  useEffect(() => {
    const errorCode = controller.errorCode;
    if (errorCode === undefined) {
      handledErrorRef.current = undefined;
      return;
    }
    if (handledErrorRef.current === errorCode) return;
    handledErrorRef.current = errorCode;
    const timeout = setTimeout(() => {
      if (errorCode === "SESSION_REQUIRED") setAuthentication("unauthenticated");
      showToast(controllerErrorMessage(errorCode, copy), "error");
    }, 0);
    return () => clearTimeout(timeout);
  }, [controller.errorCode, copy, showToast]);

  const handleAuthenticate = async (accessCode: string) => {
    await activeServices.session.authenticate(accessCode);
    try {
      const llmSettings = await readLlmSettings();
      setLlmEntries(llmSettings.entries);
      setLlmActiveProvider(llmSettings.active);
      setActiveSkillIds(await skillService.getActiveSkillIds());
      await syncWebSearchSettings();
    } catch {
      showToast(copy.genericFailure, "error");
    }
    setAuthentication("authenticated");
  };

  const handleImage = (image: ProcessedImage) => {
    const conversationId = controller.activeConversation?.id;
    if (conversationId === undefined) return;
    const imageId = crypto.randomUUID();
    const storedImage: StoredImage = {
      blob: image.blob,
      conversationId,
      height: image.height,
      id: imageId,
      mimeType: image.mimeType,
      width: image.width,
    };
    if (typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(image.blob);
      blobUrlsRef.current.set(imageId, url);
      setImageUrls(new Map(blobUrlsRef.current));
    }
    controller.setPendingImage(storedImage);
    setPendingImageDataUrl(image.dataUrl);
  };

  const handleSend = (value: string) => {
    void controller.send(value);
    setComposerValue("");
    setPendingImageDataUrl(undefined);
  };

  const handleRecall = useCallback(async () => {
    const recalled = await controller.recall();
    if (recalled) {
      if (recalled.text !== undefined) {
        setComposerValue(recalled.text);
      }
      if (recalled.imageId) {
        const image = await activeServices.repository.getImage(recalled.imageId);
        if (image) {
          controller.setPendingImage(image);
          if (typeof URL.createObjectURL === "function") {
            const url = URL.createObjectURL(image.blob);
            blobUrlsRef.current.set(image.id, url);
            setImageUrls(new Map(blobUrlsRef.current));
            setPendingImageDataUrl(url);
          }
        }
      }
      showToast(copy.recallSuccess, "info");
      await refreshHistory();
    }
  }, [activeServices, controller, copy.recallSuccess, refreshHistory, showToast]);

  const handleRegenerate = useCallback(
    async (messageId?: string) => {
      await controller.regenerate(messageId);
      await refreshHistory();
    },
    [controller, refreshHistory],
  );

  const handleLocale = async (locale: Locale) => {
    await controller.setLocale(locale);
    setMenuOpen(false);
    await refreshHistory();
  };

  const handleNewChat = async () => {
    await controller.newConversation();
    setComposerValue("");
    setPendingImageDataUrl(undefined);
    await refreshHistory();
  };

  const handleRename = async (id: string, title: string) => {
    await activeServices.repository.renameConversation(id, title);
    await refreshHistory();
  };

  const handleDelete = async (id: string) => {
    const deletingActive = controller.activeConversation?.id === id;
    await activeServices.repository.deleteConversation(id);
    if (deletingActive) {
      const remaining = await activeServices.repository.listConversations();
      if (remaining[0] === undefined) await controller.newConversation();
      else await controller.selectConversation(remaining[0].id);
    }
    await refreshHistory();
  };

  const handleClearData = async () => {
    for (const url of blobUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    blobUrlsRef.current.clear();
    setImageUrls(new Map());
    await activeServices.repository.clearAll();
    await activeServices.repository.setLocale(controller.locale);
    await llmService.clearAll();
    setActiveSkillIds([]);
    await skillService.clear();
    setWebSearchSettings(defaultWebSearchSettings);
    await webSearchService.clear().catch(() => undefined);
    setLlmEntries([]);
    setLlmActiveProvider(undefined);
    await controller.newConversation();
    setComposerValue("");
    setPendingImageDataUrl(undefined);
    await refreshHistory();
  };

  const handleSignOut = async () => {
    await controller.stop();
    await activeServices.session.signOut();
    setAuthentication("unauthenticated");
  };

  const activeProviderSupportsImage =
    activeLlmConfig === undefined ||
    PROVIDER_METADATA[activeLlmConfig.provider].imageModels.includes(activeLlmConfig.model);

  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        authentication !== "authenticated" ||
        controller.phase === "streaming" ||
        controller.phase === "compressing" ||
        controller.phase === "loading"
      ) {
        return;
      }
      if (llmOpen || skillsOpen || historyOpen || menuOpen || memoryOpen) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            if (!isOnline || controller.phase === "offline") {
              showToast(copy.offline, "error");
              return;
            }
            if (!activeProviderSupportsImage) {
              showToast(copy.llmNoImageSupport, "error");
              return;
            }
            void (activeServices.processImage ?? processImage)(file)
              .then((image) => handleImage(image))
              .catch((error) => {
                showToast(
                  imageErrorMessage(
                    error instanceof ImageProcessingError ? error.code : "IMAGE_DECODE_FAILED",
                    copy,
                  ),
                  "error",
                );
              });
            return;
          }
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [
    activeProviderSupportsImage,
    activeServices.processImage,
    authentication,
    controller.phase,
    copy,
    historyOpen,
    isOnline,
    llmOpen,
    memoryOpen,
    menuOpen,
    showToast,
    skillsOpen,
  ]);

  const authenticatedContent =
    controller.phase === "loading" ? (
      <div aria-label={copy.verifying} className="chat-loading" role="status">
        <span />
        <span />
        <span />
      </div>
    ) : (
      <>
        <TopControls
          captureDisabled={!isOnline || controller.phase === "streaming" || controller.phase === "compressing" || controller.phase === "offline" || !activeProviderSupportsImage}
          copy={copy}
          onCaptureError={(code) => showToast(imageErrorMessage(code, copy), "error")}
          onImage={handleImage}
          onMenu={() => {
            void refreshHistory();
            setMenuOpen(true);
          }}
          processImage={activeServices.processImage}
        />
        {controller.phase === "compressing" ? (
          <div aria-live="polite" className="compressing-pill" role="status">
            <Sparkles aria-hidden="true" className="compressing-pill__icon" size={16} />
            <span>{copy.compressingContext}</span>
          </div>
        ) : null}
        <ConversationView
          hasMoreHistory={controller.hasMoreHistory}
          imageUrls={imageUrls}
          key={controller.activeConversation?.id}
          locale={controller.locale}
          messages={controller.messages}
          onLoadEarlier={() => void controller.loadEarlier()}
          onRecall={handleRecall}
          onRegenerate={
            !isOnline || controller.phase === "streaming" || controller.phase === "compressing" || controller.phase === "offline"
              ? undefined
              : handleRegenerate
          }
          onToast={showToast}
          showSources={webSearchSettings.showSources}
          summary={controller.activeConversation?.summary}
        />
        <div ref={chatBottomRef} className="chat-bottom">
          <UpdatePrompt
            copy={copy}
            needRefresh={pwa.needRefresh}
            offlineReady={pwa.offlineReady}
            onConfirmOfflineReady={() => pwa.setOfflineReady(false)}
            onDismissUpdate={() => pwa.setNeedRefresh(false)}
            onUpdate={() => void pwa.updateServiceWorker(true)}
          />
          {!isOnline || controller.phase === "offline" ? <p className="status-banner">{copy.offline}</p> : null}
          {controller.phase === "error" &&
          controller.errorCode !== "DAILY_QUOTA_EXCEEDED" &&
          controller.errorCode !== "SESSION_REQUIRED" ? (
            <div className="status-banner status-banner--error">
              <span>{controllerErrorMessage(controller.errorCode ?? "", copy)}</span>
              {isRetryableChatErrorCode(controller.errorCode) ? (
                <button onClick={() => void controller.retry()} type="button">
                  {copy.retry}
                </button>
              ) : null}
            </div>
          ) : null}
          <ControlDock
            copy={copy}
            onSettings={() => {
              void refreshHistory();
              setMenuOpen(true);
            }}
            onUnavailable={(message) => showToast(message)}
          />
          <Composer
            copy={copy}
            imageDisabled={
              !isOnline ||
              controller.phase === "streaming" ||
              controller.phase === "compressing" ||
              controller.phase === "offline" ||
              !activeProviderSupportsImage
            }
            onChange={setComposerValue}
            onError={(code) => showToast(imageErrorMessage(code, copy), "error")}
            onFocus={() => {
              setTimeout(() => {
                const chatView = document.querySelector(".conversation-view");
                if (chatView) {
                  chatView.scrollTop = chatView.scrollHeight;
                }
              }, 120);
            }}
            onImage={handleImage}
            onImageDisabled={() => {
              if (!activeProviderSupportsImage) {
                showToast(copy.llmNoImageSupport, "error");
              }
            }}
            onRemoveImage={() => {
              controller.setPendingImage(undefined);
              setPendingImageDataUrl(undefined);
            }}
            onSend={handleSend}
            onStop={controller.stop}
            pendingImageDataUrl={pendingImageDataUrl}
            phase={isOnline ? controller.phase : "offline"}
            processImage={activeServices.processImage}
            value={composerValue}
          />
        </div>
        <MenuDrawer
          copy={copy}
          locale={controller.locale}
          onClearData={handleClearData}
          onClose={() => setMenuOpen(false)}
          onCompress={async () => {
            if (controller.messages.length <= 1 && !controller.activeConversation?.summary) {
              showToast(copy.noNeedToCompress, "info");
              return;
            }
            const success = await controller.compressConversation(true);
            if (success) {
              showToast(copy.compressSuccess, "info");
              await refreshHistory();
            } else if (controller.errorCode) {
              showToast(copy.compressFailed, "error");
            }
          }}
          onHistory={() => setHistoryOpen(true)}
          onLocale={handleLocale}
          onLlmSettings={() => {
            void openLlmSettings();
          }}
          onNewChat={handleNewChat}
          onSignOut={handleSignOut}
          onSkills={() => setSkillsOpen(true)}
          onUserMemory={() => setMemoryOpen(true)}
          open={menuOpen}
        />
        <HistoryPanel
          activeId={controller.activeConversation?.id}
          conversations={conversations}
          copy={copy}
          onClose={() => setHistoryOpen(false)}
          onDelete={handleDelete}
          onRename={handleRename}
          onSelect={controller.selectConversation}
          open={historyOpen}
        />
        <LlmSettingsPanel
          activeProvider={llmActiveProvider}
          copy={copy}
          entries={llmEntries}
          onActivate={handleLlmActivate}
          onClear={handleLlmClear}
          onClose={() => setLlmOpen(false)}
          onSave={handleLlmSave}
          open={llmOpen}
        />
        <SkillsPanel
          activeIds={activeSkillIds}
          copy={copy}
          onClose={() => setSkillsOpen(false)}
          onToggle={(id, next) => void handleSkillToggle(id, next)}
          onWebSearchSettingsChange={handleWebSearchSettingsChange}
          open={skillsOpen}
          skills={SKILLS}
          webSearchSettings={webSearchSettings}
        />
        <UserMemoryPanel
          copy={copy}
          memory={controller.userMemory ?? ""}
          onClose={() => setMemoryOpen(false)}
          onSave={async (memory) => {
            const saved = await controller.updateUserMemory(memory);
            if (saved) {
              showToast(copy.userMemorySaved, "info");
              setMemoryOpen(false);
            } else {
              showToast(copy.userMemorySaveFailed, "error");
            }
            return saved;
          }}
          open={memoryOpen}
        />
      </>
    );

  return (
    <main className="app-shell" aria-label="Yachiyo Chat">
      <div className="chat-stage">
        <StarfieldCanvas />
        {authentication === "checking" ? (
          <div aria-label={copy.verifying} className="chat-loading" role="status">
            <span />
            <span />
            <span />
          </div>
        ) : authentication === "unauthenticated" ? (
          <>
            <AccessGate copy={copy} onAuthenticate={handleAuthenticate} />
            <div className="access-gate__prompt">
              <UpdatePrompt
                copy={copy}
                needRefresh={pwa.needRefresh}
                offlineReady={pwa.offlineReady}
                onConfirmOfflineReady={() => pwa.setOfflineReady(false)}
                onDismissUpdate={() => pwa.setNeedRefresh(false)}
                onUpdate={() => void pwa.updateServiceWorker(true)}
              />
            </div>
          </>
        ) : (
          authenticatedContent
        )}
        <ToastRegion
          announcementId={toast?.id}
          message={toast?.message}
          tone={toast?.tone}
        />
      </div>
    </main>
  );
}
