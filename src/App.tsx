import { useCallback, useEffect, useMemo, useRef } from "react";
import { resolveAppServices, type AppServices } from "./app/app-services";
import { controllerErrorMessage, imageErrorMessage } from "./app/error-messages";
import { useAuthentication } from "./app/use-authentication";
import { useChatController } from "./app/use-chat-controller";
import { useChatPreferences } from "./app/use-chat-preferences";
import { useComposerDraft } from "./app/use-composer-draft";
import { useConversationList } from "./app/use-conversation-list";
import { useGlobalImagePaste } from "./app/use-global-image-paste";
import { useImageUrls } from "./app/use-image-urls";
import { useLlmSettings } from "./app/use-llm-settings";
import { useOnboarding } from "./app/use-onboarding";
import { resolveToastMessage, useToast } from "./app/use-toast";
import { AccessGate } from "./components/AccessGate";
import { StarfieldCanvas } from "./components/StarfieldCanvas";
import { ToastRegion } from "./components/ToastRegion";
import type { Locale } from "./domain/chat";
import { PROVIDER_METADATA } from "./domain/llm";
import { ImageProcessingError } from "./features/capture/image-processor";
import { copyFor } from "./i18n/messages";
import { UpdatePrompt } from "./pwa/UpdatePrompt";
import { useOnlineStatus } from "./pwa/use-online-status";
import { usePwaUpdate } from "./pwa/use-pwa-update";
import { clearWebCaches } from "./services/api-origins";
import { isNativeApp } from "./services/app-platform";
import type { SharedViewProps } from "./views/layout-types";
import { MobileLayout } from "./views/mobile/MobileLayout";

export interface AppProps {
  services?: AppServices;
}

function LoadingIndicator({ label }: { label: string }) {
  return (
    <div aria-label={label} className="chat-loading" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

/** 应用组合根：装配各领域 hook，编排跨领域的会话与数据操作，再交给布局渲染。 */
export function App({ services }: AppProps) {
  const appServices = useMemo(() => resolveAppServices(services), [services]);
  const { repository, session } = appServices;
  const { isOnline } = useOnlineStatus();
  const pwa = usePwaUpdate();
  const { toast, showToast } = useToast();
  const notifyGenericFailure = useCallback(() => showToast((copy) => copy.genericFailure, "error"), [showToast]);
  const notifyStorageFull = useCallback(() => showToast((copy) => copy.storageFull, "error"), [showToast]);

  const llm = useLlmSettings(appServices.llmSettings, notifyGenericFailure);
  const preferences = useChatPreferences({
    repository,
    skillService: appServices.skillSettings,
    webSearchService: appServices.webSearchSettings,
  });
  const onboarding = useOnboarding(repository, notifyStorageFull);

  const controller = useChatController({
    repository,
    streamChat: appServices.streamChat,
    activeLlmConfig: llm.activeConfig,
    activeSkills: preferences.activeSkills,
    multiBubble: preferences.multiBubble,
    webSearchEnabled: preferences.webSearch.enabled,
    webSearchSmart: preferences.webSearch.smart,
  });
  const copy = copyFor(controller.locale);
  const {
    deleteConversation,
    newConversation,
    recall,
    regenerate,
    selectConversation,
    setLocale,
    setOnline,
    stop,
    updateUserMemory,
  } = controller;

  const { load: loadLlm } = llm;
  const { load: loadPreferences } = preferences;
  const loadAuthenticatedState = useCallback(async () => {
    await Promise.all([loadLlm().catch(notifyGenericFailure), loadPreferences()]);
  }, [loadLlm, loadPreferences, notifyGenericFailure]);
  const authentication = useAuthentication({
    session,
    isOnline,
    loadAuthenticatedState,
    onCheckFailed: notifyGenericFailure,
  });
  const authenticated = authentication.state === "authenticated";

  const conversations = useConversationList({
    repository,
    enabled: authenticated,
    activeConversation: controller.activeConversation,
    onStorageError: notifyStorageFull,
  });
  const { refresh: refreshConversations } = conversations;
  const getImage = useCallback((id: string) => repository.getImage(id), [repository]);
  const images = useImageUrls(getImage, controller.messages);
  const draft = useComposerDraft({ controller, getImage, registerImageUrl: images.register });

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = controller.locale;
    return () => {
      document.documentElement.lang = previousLanguage;
    };
  }, [controller.locale]);

  useEffect(() => {
    const timeout = setTimeout(() => setOnline(isOnline), 0);
    return () => clearTimeout(timeout);
  }, [isOnline, setOnline]);

  // 原生壳启动自愈：清掉旧版 APK 可能残留的 Service Worker 与缓存
  useEffect(() => {
    if (isNativeApp()) void clearWebCaches();
  }, []);

  const handledErrorRef = useRef<string | undefined>(undefined);
  const { expire } = authentication;
  useEffect(() => {
    const errorCode = controller.errorCode;
    if (errorCode === undefined) {
      handledErrorRef.current = undefined;
      return;
    }
    if (handledErrorRef.current === errorCode) return;
    handledErrorRef.current = errorCode;
    const timeout = setTimeout(() => {
      if (errorCode === "SESSION_REQUIRED") expire();
      showToast((current) => controllerErrorMessage(errorCode, current), "error");
    }, 0);
    return () => clearTimeout(timeout);
  }, [controller.errorCode, expire, showToast]);

  const { restore: restoreDraft, clear: clearDraft } = draft;
  const handleRecall = useCallback(async () => {
    const recalled = await recall();
    if (recalled === undefined) return;
    await restoreDraft(recalled);
    showToast(copy.recallSuccess, "info");
    await refreshConversations();
  }, [copy.recallSuccess, recall, refreshConversations, restoreDraft, showToast]);

  const handleRegenerate = useCallback(async (messageId?: string) => {
    await regenerate(messageId);
    await refreshConversations();
  }, [refreshConversations, regenerate]);

  const handleNewChat = useCallback(async () => {
    await newConversation();
    clearDraft();
    await refreshConversations();
  }, [clearDraft, newConversation, refreshConversations]);

  const handleLocale = async (locale: Locale) => {
    await setLocale(locale);
    await refreshConversations();
  };

  const activeConversationId = controller.activeConversation?.id;
  const handleDelete = async (id: string) => {
    if (!await deleteConversation(id)) return;
    if (activeConversationId === id) {
      const [next] = await repository.listConversations();
      if (next === undefined) await newConversation();
      else await selectConversation(next.id);
    }
    await refreshConversations();
  };

  const handleClearData = async () => {
    await stop();
    images.revokeAll();
    await repository.clearAll();
    await updateUserMemory("");
    await repository.setLocale(controller.locale);
    await llm.reset();
    await preferences.reset();
    await newConversation();
    clearDraft();
    await refreshConversations();
  };

  const handleSignOut = async () => {
    await stop();
    await authentication.signOut();
  };

  const activeConfig = llm.activeConfig;
  const imageSupported =
    activeConfig === undefined ||
    PROVIDER_METADATA[activeConfig.provider].imageModels.includes(activeConfig.model);
  const generating =
    controller.phase === "streaming" || controller.phase === "compressing" || controller.phase === "loading";

  useGlobalImagePaste(authenticated && !generating, (file) => {
    if (!isOnline || controller.phase === "offline") {
      showToast(copy.offline, "error");
      return;
    }
    if (!imageSupported) {
      showToast(copy.llmNoImageSupport, "error");
      return;
    }
    void appServices.processImage(file)
      .then(draft.attachImage)
      .catch((error: unknown) => {
        const code = error instanceof ImageProcessingError ? error.code : "IMAGE_DECODE_FAILED";
        showToast(imageErrorMessage(code, copy), "error");
      });
  });

  const viewProps: SharedViewProps = {
    controller,
    copy,
    isOnline,
    imageUrls: images.imageUrls,
    pwa,
    showToast,
    composer: { ...draft, imageSupported, processImage: appServices.processImage },
    messageActions: { recall: handleRecall, regenerate: handleRegenerate },
    conversations: {
      items: conversations.items,
      refresh: refreshConversations,
      search: conversations.search,
      create: handleNewChat,
      rename: conversations.rename,
      remove: handleDelete,
    },
    settings: {
      llm,
      activeSkillIds: preferences.activeSkillIds,
      toggleSkill: preferences.toggleSkill,
      webSearch: preferences.webSearch,
      changeWebSearch: preferences.changeWebSearch,
      multiBubble: preferences.multiBubble,
      changeMultiBubble: preferences.changeMultiBubble,
    },
    onboarding,
    account: { setLocale: handleLocale, clearData: handleClearData, signOut: handleSignOut },
  };

  return (
    <main className="app-shell" aria-label="Yachiyo Chat">
      <div className="chat-stage">
        <StarfieldCanvas />
        {authentication.state === "checking" ? (
          <LoadingIndicator label={copy.verifying} />
        ) : authentication.state === "unauthenticated" ? (
          <>
            <AccessGate copy={copy} onAuthenticate={authentication.authenticate} />
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
        ) : controller.phase === "loading" ? (
          <LoadingIndicator label={copy.verifying} />
        ) : (
          <MobileLayout {...viewProps} />
        )}
        <ToastRegion
          announcementId={toast?.id}
          message={toast === undefined ? undefined : resolveToastMessage(toast.message, copy)}
          tone={toast?.tone}
        />
      </div>
    </main>
  );
}
