import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAndroidBack } from "../../app/use-android-back";
import { Composer } from "../../components/Composer";
import { ControlDock } from "../../components/ControlDock";
import { ConversationView } from "../../components/ConversationView";
import { HistoryPanel } from "../../components/HistoryPanel";
import { LlmSettingsPanel } from "../../components/LlmSettingsPanel";
import { MenuDrawer } from "../../components/MenuDrawer";
import { SkillsPanel } from "../../components/SkillsPanel";
import { TopControls } from "../../components/TopControls";
import { UserMemoryPanel } from "../../components/UserMemoryPanel";
import { UpdatePrompt } from "../../pwa/UpdatePrompt";
import { isRetryableChatErrorCode } from "../../services/chat-client";
import { SKILLS } from "../../skills";
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
  onRename,
  onDelete,
  onClearData,
  onLocale,
  onSignOut,
  onLlmSave,
  onLlmClear,
  onLlmActivate,
  onSkillToggle,
  onWebSearchSettingsChange,
  showToast,
  refreshHistory,
  refreshLlm,
}: SharedViewProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

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

  // 动态测量底部输入区域高度以保持消息滚动间距
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
  }, []);

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

  const openLlmSettings = useCallback(async () => {
    await refreshLlm();
    setLlmOpen(true);
  }, [refreshLlm]);

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
        onLoadEarlier={() => void controller.loadEarlier()}
        onRecall={onRecall}
        onRegenerate={
          !isOnline ||
          controller.phase === "streaming" ||
          controller.phase === "compressing" ||
          controller.phase === "offline"
            ? undefined
            : onRegenerate
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
          onSend={onSend}
          onStop={controller.stop}
          pendingImageDataUrl={pendingImageDataUrl}
          phase={isOnline ? controller.phase : "offline"}
          processImage={processImage}
          value={composerValue}
        />
      </div>

      <MenuDrawer
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
          void openLlmSettings();
        }}
        onNewChat={onNewChat}
        onSignOut={onSignOut}
        onSkills={() => setSkillsOpen(true)}
        onUserMemory={() => setMemoryOpen(true)}
        open={menuOpen}
      />

      <HistoryPanel
        activeId={controller.activeConversation?.id}
        conversations={conversations}
        copy={copy}
        onClose={() => setHistoryOpen(false)}
        onDelete={onDelete}
        onRename={onRename}
        onSelect={controller.selectConversation}
        open={historyOpen}
      />

      <LlmSettingsPanel
        activeProvider={llmActiveProvider}
        copy={copy}
        entries={llmEntries}
        onActivate={onLlmActivate}
        onClear={onLlmClear}
        onClose={() => setLlmOpen(false)}
        onSave={onLlmSave}
        open={llmOpen}
      />

      <SkillsPanel
        activeIds={activeSkillIds}
        copy={copy}
        onClose={() => setSkillsOpen(false)}
        onToggle={(id, next) => void onSkillToggle(id, next)}
        onWebSearchSettingsChange={onWebSearchSettingsChange}
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
}
