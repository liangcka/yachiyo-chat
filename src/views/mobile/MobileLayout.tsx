import { useCallback, useState } from "react";
import { Sparkles } from "lucide-react";
import { controllerErrorMessage, imageErrorMessage } from "../../app/error-messages";
import { useAndroidBack } from "../../app/use-android-back";
import { Composer } from "../../components/Composer";
import { ControlDock } from "../../components/ControlDock";
import { ConversationView } from "../../components/ConversationView";
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
import type { SharedViewProps } from "../layout-types";
import { useKeyboardAwareDock } from "./use-keyboard-aware-dock";

export function MobileLayout({
  account,
  composer,
  controller,
  conversations,
  copy,
  imageUrls,
  isOnline,
  messageActions,
  onboarding,
  pwa,
  settings,
  showToast,
}: SharedViewProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // 会话列表的日期分组以打开侧边栏的时刻为基准
  const [menuOpenedAt, setMenuOpenedAt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("model");
  // 解构消费：结果中含 ref，成员访问会被编译器视为渲染期读 ref
  const {
    chatBottomRef,
    collapsed: dockCollapsed,
    expand: expandDock,
    handleComposerBlur,
    handleComposerFocus,
    reset: resetDock,
    setScrollCollapsed,
  } = useKeyboardAwareDock(controller.activeConversation?.id, controller.messages.length > 0);

  const nativeUpdateBlocked =
    (controller.phase !== "idle" && controller.phase !== "offline" && controller.phase !== "error") ||
    composer.value.length > 0 || composer.pendingImageDataUrl !== undefined ||
    settingsOpen || menuOpen || onboarding.open;
  const nativeUpdate = useNativeUpdate({
    blocked: nativeUpdateBlocked,
    prepareForReload: controller.prepareForReload,
  });

  const networkActionsDisabled =
    !isOnline ||
    controller.phase === "streaming" ||
    controller.phase === "compressing" ||
    controller.phase === "offline";
  const imageInputDisabled = networkActionsDisabled || !composer.imageSupported;

  // APK 原生壳：返回键先关弹层，2 秒内再按一次才退出
  useAndroidBack(
    () => {
      if (onboarding.open) {
        onboarding.close();
        return true;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
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

  const { refresh: refreshConversations, create: createConversation } = conversations;
  const openMenu = useCallback(() => {
    void refreshConversations();
    setMenuOpenedAt(Date.now());
    setMenuOpen(true);
  }, [refreshConversations]);

  const handleNewChat = useCallback(async () => {
    resetDock();
    await createConversation();
  }, [createConversation, resetDock]);

  const selectConversation = controller.selectConversation;
  const handleSelectConversation = useCallback(async (id: string) => {
    resetDock();
    await selectConversation(id);
  }, [resetDock, selectConversation]);

  const { send: sendDraft } = composer;
  const handleSend = useCallback((text: string) => {
    expandDock();
    sendDraft(text);
  }, [expandDock, sendDraft]);

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

  const refreshLlm = settings.llm.refresh;
  const openSettings = useCallback(async (tab: SettingsTabId) => {
    if (tab === "model") await refreshLlm();
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, [refreshLlm]);

  const handleCompress = async () => {
    if (controller.messages.length <= 1 && !controller.activeConversation?.summary) {
      showToast(copy.noNeedToCompress, "info");
      return;
    }
    const success = await controller.compressConversation(true);
    if (success) {
      showToast(copy.compressSuccess, "info");
      await refreshConversations();
    } else if (controller.errorCode) {
      showToast(copy.compressFailed, "error");
    }
  };

  return (
    <>
      <TopControls
        captureDisabled={imageInputDisabled}
        copy={copy}
        onCaptureError={(code) => showToast(imageErrorMessage(code, copy), "error")}
        onImage={composer.attachImage}
        onMenu={openMenu}
        processImage={composer.processImage}
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
        multiBubble={settings.multiBubble}
        onLoadEarlier={() => void controller.loadEarlier()}
        onRecall={messageActions.recall}
        onRemember={networkActionsDisabled ? undefined : handleRemember}
        onRegenerate={networkActionsDisabled ? undefined : messageActions.regenerate}
        onBottomDockCollapseChange={setScrollCollapsed}
        onToast={showToast}
        showSources={settings.webSearch.showSources}
        summary={controller.activeConversation?.summary}
      />

      <div
        ref={chatBottomRef}
        className={`chat-bottom${dockCollapsed ? " chat-bottom--collapsed" : ""}`}
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
          onSettings={openMenu}
          onUnavailable={(message) => showToast(message)}
        />
        <Composer
          copy={copy}
          imageDisabled={imageInputDisabled}
          onBlur={handleComposerBlur}
          onChange={composer.setValue}
          onError={(code) => showToast(imageErrorMessage(code, copy), "error")}
          onFocus={handleComposerFocus}
          onImage={composer.attachImage}
          onImageDisabled={() => {
            if (!composer.imageSupported) {
              showToast(copy.llmNoImageSupport, "error");
            }
          }}
          onRemoveImage={composer.removeImage}
          onSend={handleSend}
          onStop={controller.stop}
          pendingImageDataUrl={composer.pendingImageDataUrl}
          phase={isOnline ? controller.phase : "offline"}
          processImage={composer.processImage}
          value={composer.value}
        />
      </div>

      <MenuDrawer
        activeModelLabel={
          settings.llm.activeProvider !== undefined
            ? PROVIDER_METADATA[settings.llm.activeProvider].label
            : copy.defaultModelLabel
        }
        conversations={{
          activeId: controller.activeConversation?.id,
          conversations: conversations.items,
          now: menuOpenedAt,
          onDelete: conversations.remove,
          onRename: conversations.rename,
          onSearch: conversations.search,
          onSelect: handleSelectConversation,
        }}
        copy={copy}
        locale={controller.locale}
        onClearData={account.clearData}
        onClose={() => setMenuOpen(false)}
        onCompress={() => void handleCompress()}
        onLocale={account.setLocale}
        onNewChat={handleNewChat}
        onOpenSettings={(tab) => void openSettings(tab)}
        onSignOut={account.signOut}
        open={menuOpen}
      />

      <SettingsPanel
        activeProvider={settings.llm.activeProvider}
        activeSkillIds={settings.activeSkillIds}
        copy={copy}
        entries={settings.llm.entries}
        initialTab={settingsTab}
        multiBubble={settings.multiBubble}
        nativeUpdate={nativeUpdate}
        onClose={() => setSettingsOpen(false)}
        onOpenOnboarding={() => {
          setSettingsOpen(false);
          setMenuOpen(false);
          onboarding.reopen();
        }}
        onLlmActivate={settings.llm.activate}
        onLlmClear={settings.llm.clear}
        onLlmSave={settings.llm.save}
        onMultiBubbleChange={(enabled) => void settings.changeMultiBubble(enabled)}
        onSkillToggle={(id, next) => void settings.toggleSkill(id, next)}
        onWebSearchSettingsChange={settings.changeWebSearch}
        open={settingsOpen}
        skills={SKILLS}
        userMemory={controller.userMemory ?? ""}
        webSearchSettings={settings.webSearch}
      />

      <OnboardingGuide
        copy={copy}
        onClose={onboarding.close}
        onOpenSettings={() => {
          onboarding.close();
          void openSettings("model");
        }}
        open={onboarding.open}
      />
    </>
  );
}
