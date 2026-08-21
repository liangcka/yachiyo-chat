import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useChatController, type ChatRepository, type StreamChatFunction } from "./app/use-chat-controller";
import { AccessGate } from "./components/AccessGate";
import { Composer } from "./components/Composer";
import { ControlDock } from "./components/ControlDock";
import { ConversationView } from "./components/ConversationView";
import { HistoryPanel } from "./components/HistoryPanel";
import { LlmSettingsPanel, type LlmProviderEntry } from "./components/LlmSettingsPanel";
import { MenuDrawer } from "./components/MenuDrawer";
import { SkillsPanel } from "./components/SkillsPanel";
import { StarfieldCanvas } from "./components/StarfieldCanvas";
import { ToastRegion } from "./components/ToastRegion";
import { TopControls } from "./components/TopControls";
import { ConversationRepository } from "./data/conversation-repository";
import { YachiyoDatabase } from "./data/db";
import type { Conversation, Locale, StoredImage } from "./domain/chat";
import { PROVIDER_METADATA, type ActiveLlmConfig, type ProviderId } from "./domain/llm";
import { processImage, type ImageProcessingErrorCode, type ProcessedImage } from "./features/capture/image-processor";
import { copyFor, type UiCopy } from "./i18n/messages";
import { UpdatePrompt } from "./pwa/UpdatePrompt";
import { usePwaUpdate } from "./pwa/use-pwa-update";
import { useOnlineStatus } from "./pwa/use-online-status";
import { streamChat } from "./services/chat-client";
import { LlmSettingsService } from "./services/llm-settings";
import { SessionClient } from "./services/session-client";
import { SkillSettingsService } from "./services/skill-settings";
import { WebSearchSettingsService, defaultWebSearchSettings } from "./services/web-search-settings";
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

function isRetryableGenerationError(code: string | undefined): boolean {
  return (
    code === "PROVIDER_ERROR" ||
    code === "SERVICE_UNAVAILABLE" ||
    code === "NETWORK_ERROR" ||
    code === "STREAM_ERROR"
  );
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
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchShowSources, setWebSearchShowSources] = useState(true);
  const [webSearchSmart, setWebSearchSmart] = useState(false);
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
    webSearchEnabled,
    webSearchSmart,
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
          const webSearch = await webSearchService
            .getWebSearchSettings()
            .catch(() => defaultWebSearchSettings);
          if (!cancelled) {
            setWebSearchEnabled(webSearch.enabled);
            setWebSearchShowSources(webSearch.showSources);
            setWebSearchSmart(webSearch.smart);
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
  }, [activeServices, isOnline, readLlmSettings, skillService, webSearchService]);

  useEffect(() => {
    const timeout = setTimeout(() => setControllerOnline(isOnline), 0);
    return () => clearTimeout(timeout);
  }, [isOnline, setControllerOnline]);

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

  const handleWebSearchEnabledChange = useCallback(
    (next: boolean) => {
      setWebSearchEnabled(next);
      void webSearchService.setEnabled(next).catch(() => undefined);
    },
    [webSearchService],
  );

  const handleWebSearchShowSourcesChange = useCallback(
    (next: boolean) => {
      setWebSearchShowSources(next);
      void webSearchService.setShowSources(next).catch(() => undefined);
    },
    [webSearchService],
  );

  const handleWebSearchSmartChange = useCallback(
    (next: boolean) => {
      setWebSearchSmart(next);
      void webSearchService.setSmart(next).catch(() => undefined);
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

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") {
      return;
    }
    let cancelled = false;
    const messageImageIds = [
      ...new Set(
        controller.messages.flatMap(({ imageId }) => (imageId === undefined ? [] : [imageId])),
      ),
    ];
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
  }, [activeServices, controller.messages]);

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
      const webSearch = await webSearchService
        .getWebSearchSettings()
        .catch(() => defaultWebSearchSettings);
      setWebSearchEnabled(webSearch.enabled);
      setWebSearchShowSources(webSearch.showSources);
      setWebSearchSmart(webSearch.smart);
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
    setWebSearchEnabled(false);
    setWebSearchShowSources(true);
    setWebSearchSmart(false);
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
        <ConversationView
          imageUrls={imageUrls}
          key={controller.activeConversation?.id}
          locale={controller.locale}
          messages={controller.messages}
          onRecall={handleRecall}
          onRegenerate={
            !isOnline || controller.phase === "streaming" || controller.phase === "compressing" || controller.phase === "offline"
              ? undefined
              : handleRegenerate
          }
          onToast={showToast}
          showSources={webSearchShowSources}
          summary={controller.activeConversation?.summary}
        />
        <div className="chat-bottom">
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
              {isRetryableGenerationError(controller.errorCode) ? (
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
            onChange={setComposerValue}
            onRemoveImage={() => {
              controller.setPendingImage(undefined);
              setPendingImageDataUrl(undefined);
            }}
            onSend={handleSend}
            onStop={controller.stop}
            pendingImageDataUrl={pendingImageDataUrl}
            phase={isOnline ? controller.phase : "offline"}
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
          onWebSearchEnabledChange={handleWebSearchEnabledChange}
          onWebSearchShowSourcesChange={handleWebSearchShowSourcesChange}
          onWebSearchSmartChange={handleWebSearchSmartChange}
          open={skillsOpen}
          skills={SKILLS}
          webSearchEnabled={webSearchEnabled}
          webSearchShowSources={webSearchShowSources}
          webSearchSmart={webSearchSmart}
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
