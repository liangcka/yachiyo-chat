import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAndroidBack } from "../../app/use-android-back";
import { Composer } from "../../components/Composer";
import { ControlDock } from "../../components/ControlDock";
import { ConversationView } from "../../components/ConversationView";
import { HistoryPanel } from "../../components/HistoryPanel";
import { MenuDrawer } from "../../components/MenuDrawer";
import { OnboardingGuide } from "../../components/OnboardingGuide";
import { SettingsPanel, type SettingsTabId } from "../../components/SettingsPanel";
import { TopControls } from "../../components/TopControls";
import { UpdatePrompt } from "../../pwa/UpdatePrompt";
import { isRetryableChatErrorCode } from "../../services/chat-client";
import { PROVIDER_METADATA } from "../../domain/llm";
import { SKILLS } from "../../skills";
import { NativeUpdatePrompt } from "../../update/NativeUpdateControls";
import { useNativeUpdate } from "../../update/use-native-update";
import { controllerErrorMessage, imageErrorMessage, type SharedViewProps } from "../layout-types";

export function MobileLayout({
  controller,
  copy,
  isOnline,
  conversations,
  imageUrls,
  pendingImageDataUrl,
  composerValue,
  setComposerValue,
  activeProviderSupportsImage,
  activeSkillIds,
  llmActiveProvider,
  llmEntries,
  webSearchSettings,
  pwa,
  processImage,
  setPendingImageDataUrl,
  onSend,
  onImage,
  onRecall,
  onRegenerate,
  onNewChat,
  onboardingOpen,
  onCloseOnboarding,
  onOpenOnboarding,
  onRename,
  onDelete,
  onSearchConversations,
  onClearData,
  onLocale,
  onSignOut,
  onLlmSave,
  onLlmClear,
  onLlmActivate,
  onSkillToggle,
  onWebSearchSettingsChange,
  multiBubble,
  onMultiBubbleChange,
  showToast,
  refreshHistory,
  refreshLlm,
}: SharedViewProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("model");
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [prevConversationId, setPrevConversationId] = useState(controller.activeConversation?.id);
  const baseViewportHeightRef = useRef(0);
  const nativeUpdateBlocked =
    (controller.phase !== "idle" && controller.phase !== "offline" && controller.phase !== "error") ||
    composerValue.length > 0 || pendingImageDataUrl !== undefined ||
    settingsOpen || historyOpen || menuOpen || onboardingOpen;
  const nativeUpdate = useNativeUpdate({
    blocked: nativeUpdateBlocked,
    prepareForReload: controller.prepareForReload,
  });

  if (controller.activeConversation?.id !== prevConversationId) {
    setPrevConversationId(controller.activeConversation?.id);
    setDockCollapsed(false);
    setIsKeyboardOpen(false);
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("keyboard-open");
    }
  }

  // 软键盘弹起或历史消息上滑时收缩四格小组件，优先保证输入与阅读视野
  const isDockCollapsed =
    (dockCollapsed || isKeyboardOpen) && controller.messages.length > 0;

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const scrollChatToBottom = useCallback((smooth = false) => {
    const chatView = document.querySelector(".conversation-view");
    if (!chatView) return;
    const targetScroll = chatView.scrollHeight - chatView.clientHeight;
    if (targetScroll > 0) {
      if (smooth && typeof chatView.scrollTo === "function") {
        chatView.scrollTo({
          top: targetScroll,
          behavior: "smooth",
        });
      } else {
        chatView.scrollTop = targetScroll;
      }
    }
  }, []);

  // 移动端与软键盘适配：实时同步 visualViewport 高度至 CSS 变量
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;

    const isInputFocused = () => {
      const activeEl = document.activeElement;
      return (
        activeEl instanceof HTMLElement &&
        (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT")
      );
    };

    const handleViewportChange = () => {
      const height = vv.height;
      document.documentElement.style.setProperty("--visual-viewport-height", `${height}px`);

      if (height > baseViewportHeightRef.current) {
        baseViewportHeightRef.current = height;
      }

      // 当视口高度比无键盘基准显著缩小（> 120px）时，判定为软键盘弹起
      const keyboardOpen = baseViewportHeightRef.current - height > 120;
      setIsKeyboardOpen((prev) => {
        if (prev !== keyboardOpen) {
          if (keyboardOpen) {
            document.documentElement.classList.add("keyboard-open");
            requestAnimationFrame(() => scrollChatToBottom(false));
          } else {
            document.documentElement.classList.remove("keyboard-open");
            setDockCollapsed(false);
          }
          return keyboardOpen;
        }
        return prev;
      });
    };

    handleViewportChange();
    vv.addEventListener("resize", handleViewportChange);

    // 当输入框失去焦点时，确保软键盘状态被彻底清除，杜绝无焦点时 ControlDock 被锁死隐藏
    const handleFocusOut = () => {
      setTimeout(() => {
        if (!isInputFocused()) {
          baseViewportHeightRef.current = vv.height;
          document.documentElement.classList.remove("keyboard-open");
          setIsKeyboardOpen(false);
          setDockCollapsed(false);
        }
      }, 50);
    };
    window.addEventListener("focusout", handleFocusOut);

    const handleOrientationChange = () => {
      baseViewportHeightRef.current = 0;
    };
    window.addEventListener("orientationchange", handleOrientationChange);

    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("orientationchange", handleOrientationChange);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.classList.remove("keyboard-open");
    };
  }, [scrollChatToBottom]);

  const isDockCollapsedRef = useRef(isDockCollapsed);
  const isKeyboardOpenRef = useRef(isKeyboardOpen);
  const lastExpandedHeightRef = useRef(0);

  useEffect(() => {
    isDockCollapsedRef.current = isDockCollapsed;
    isKeyboardOpenRef.current = isKeyboardOpen;
  }, [isDockCollapsed, isKeyboardOpen]);

  const updateBottomHeight = useCallback(() => {
    const bottomEl = chatBottomRef.current;
    if (!bottomEl) return;
    const height = bottomEl.getBoundingClientRect().height;
    if (height > 0) {
      const isCollapsed = isDockCollapsedRef.current;
      const isKbd = isKeyboardOpenRef.current;
      if (!isCollapsed) {
        lastExpandedHeightRef.current = height;
      }
      // 键盘弹起时以实际收缩高度贴合；普通浏览上滑折叠时保留展开占位以防历史视口跳动
      const targetHeight =
        isCollapsed && lastExpandedHeightRef.current > 0
          ? (isKbd ? height : lastExpandedHeightRef.current)
          : height;
      document.documentElement.style.setProperty(
        "--chat-bottom-height",
        `${Math.round(targetHeight)}px`,
      );
    }
  }, []);

  // 动态测量底部输入区域高度以保持消息滚动间距，防止收缩时底部留白塌陷遮挡消息
  useEffect(() => {
    const bottomEl = chatBottomRef.current;
    if (!bottomEl || typeof ResizeObserver === "undefined") return;

    updateBottomHeight();
    const observer = new ResizeObserver(updateBottomHeight);
    observer.observe(bottomEl);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--chat-bottom-height");
    };
  }, [updateBottomHeight]);

  useEffect(() => {
    updateBottomHeight();
  }, [isDockCollapsed, isKeyboardOpen, updateBottomHeight]);

  // 当底栏因翻阅历史处于收缩状态且软键盘未打开时，点击底栏空白毛玻璃区域直接恢复展开
  useEffect(() => {
    const bottomEl = chatBottomRef.current;
    if (!bottomEl) return;

    const handleBottomClick = (event: MouseEvent) => {
      if (isDockCollapsedRef.current && !isKeyboardOpenRef.current) {
        const target = event.target as HTMLElement | null;
        if (target && !target.closest("button") && !target.closest("textarea") && !target.closest("input")) {
          setDockCollapsed(false);
        }
      }
    };

    bottomEl.addEventListener("click", handleBottomClick);
    return () => {
      bottomEl.removeEventListener("click", handleBottomClick);
    };
  }, []);

  // APK 原生壳：返回键先关弹层，2 秒内再按一次才退出
  useAndroidBack(
    () => {
      if (onboardingOpen) {
        onCloseOnboarding();
        return true;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
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

  const handleNewChat = useCallback(async () => {
    setDockCollapsed(false);
    setIsKeyboardOpen(false);
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("keyboard-open");
    }
    await onNewChat();
  }, [onNewChat]);

  const selectConversation = controller.selectConversation;
  const handleSelectConversation = useCallback(
    async (id: string) => {
      setDockCollapsed(false);
      setIsKeyboardOpen(false);
      if (typeof document !== "undefined") {
        document.documentElement.classList.remove("keyboard-open");
      }
      await selectConversation(id);
    },
    [selectConversation],
  );

  const handleSend = useCallback(
    async (text: string) => {
      setDockCollapsed(false);
      await onSend(text);
    },
    [onSend],
  );

  const rememberMessage = controller.rememberMessage;
  const handleRemember = useCallback((messageId: string) => {
    showToast(copy.rememberMessagePending);
    void rememberMessage(messageId).then((outcome) => {
      if (outcome === "saved") showToast(copy.userMemorySaved);
      else if (outcome === "unchanged") showToast(copy.rememberMessageUnchanged);
      else if (outcome === "too-long") showToast(copy.rememberMessageTooLong, "error");
      else if (outcome === "failed") showToast(copy.userMemorySaveFailed, "error");
    });
  }, [rememberMessage, copy.rememberMessagePending, copy.userMemorySaved, copy.rememberMessageUnchanged,
    copy.rememberMessageTooLong, copy.userMemorySaveFailed, showToast]);

  const openSettings = useCallback(
    async (tab: SettingsTabId = "model") => {
      if (tab === "model") {
        await refreshLlm();
      }
      setSettingsTab(tab);
      setSettingsOpen(true);
    },
    [refreshLlm],
  );

  return (
    <>
      <TopControls
        captureDisabled={
          !isOnline ||
          controller.phase === "streaming" ||
          controller.phase === "compressing" ||
          controller.phase === "offline" ||
          !activeProviderSupportsImage
        }
        copy={copy}
        onCaptureError={(code) => showToast(imageErrorMessage(code, copy), "error")}
        onImage={onImage}
        onMenu={() => {
          void refreshHistory();
          setMenuOpen(true);
        }}
        processImage={processImage}
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
        multiBubble={multiBubble}
        onLoadEarlier={() => void controller.loadEarlier()}
        onRecall={onRecall}
        onRemember={
          !isOnline || controller.phase === "streaming" || controller.phase === "compressing" || controller.phase === "offline"
            ? undefined
            : handleRemember
        }
        onRegenerate={
          !isOnline ||
          controller.phase === "streaming" ||
          controller.phase === "compressing" ||
          controller.phase === "offline"
            ? undefined
            : onRegenerate
        }
        onBottomDockCollapseChange={setDockCollapsed}
        onToast={showToast}
        showSources={webSearchSettings.showSources}
        summary={controller.activeConversation?.summary}
      />

      <div
        ref={chatBottomRef}
        className={`chat-bottom${isDockCollapsed ? " chat-bottom--collapsed" : ""}`}
      >
        <UpdatePrompt
          copy={copy}
          needRefresh={pwa.needRefresh}
          offlineReady={pwa.offlineReady}
          onConfirmOfflineReady={() => pwa.setOfflineReady(false)}
          onDismissUpdate={() => pwa.setNeedRefresh(false)}
          onUpdate={() => void pwa.updateServiceWorker(true)}
        />
        <NativeUpdatePrompt blocked={nativeUpdateBlocked} copy={copy} update={nativeUpdate} />
        {!isOnline || controller.phase === "offline" ? (
          <p className="status-banner">{copy.offline}</p>
        ) : null}
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
          onBlur={() => {
            setTimeout(() => {
              const activeEl = document.activeElement;
              const inputFocused =
                activeEl instanceof HTMLElement &&
                (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT");
              if (!inputFocused && typeof window !== "undefined" && window.visualViewport) {
                baseViewportHeightRef.current = window.visualViewport.height;
                document.documentElement.classList.remove("keyboard-open");
                setIsKeyboardOpen(false);
                setDockCollapsed(false);
              }
            }, 50);
          }}
          onChange={setComposerValue}
          onError={(code) => showToast(imageErrorMessage(code, copy), "error")}
          onFocus={() => {
            setTimeout(() => scrollChatToBottom(false), 280);
          }}
          onImage={onImage}
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
          processImage={processImage}
          value={composerValue}
        />
      </div>

      <MenuDrawer
        activeModelLabel={
          llmActiveProvider !== undefined
            ? PROVIDER_METADATA[llmActiveProvider].label
            : copy.defaultModelLabel
        }
        copy={copy}
        locale={controller.locale}
        onClearData={onClearData}
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
        onLocale={onLocale}
        onLlmSettings={() => {
          void openSettings("model");
        }}
        onNewChat={handleNewChat}
        onOpenSettings={(tab) => {
          void openSettings(tab ?? "model");
        }}
        onPreferences={() => {
          void openSettings("preferences");
        }}
        onSignOut={onSignOut}
        onSkills={() => {
          void openSettings("skills");
        }}
        onUserMemory={() => {
          void openSettings("memory");
        }}
        open={menuOpen}
      />

      <HistoryPanel
        activeId={controller.activeConversation?.id}
        conversations={conversations}
        copy={copy}
        onClose={() => setHistoryOpen(false)}
        onDelete={onDelete}
        onRename={onRename}
        onSearch={onSearchConversations}
        onSelect={handleSelectConversation}
        open={historyOpen}
      />

      <SettingsPanel
        activeProvider={llmActiveProvider}
        activeSkillIds={activeSkillIds}
        copy={copy}
        entries={llmEntries}
        initialTab={settingsTab}
        multiBubble={multiBubble}
        nativeUpdate={nativeUpdate}
        onClose={() => setSettingsOpen(false)}
        onOpenOnboarding={() => {
          setSettingsOpen(false);
          setMenuOpen(false);
          onOpenOnboarding();
        }}
        onLlmActivate={onLlmActivate}
        onLlmClear={onLlmClear}
        onLlmSave={onLlmSave}
        onMultiBubbleChange={onMultiBubbleChange}
        onSkillToggle={(id, next) => void onSkillToggle(id, next)}
        onWebSearchSettingsChange={onWebSearchSettingsChange}
        open={settingsOpen}
        skills={SKILLS}
        userMemory={controller.userMemory ?? ""}
        webSearchSettings={webSearchSettings}
      />

      <OnboardingGuide
        copy={copy}
        onClose={onCloseOnboarding}
        onOpenSettings={() => {
          onCloseOnboarding();
          void openSettings("model");
        }}
        open={onboardingOpen}
      />
    </>
  );
}
