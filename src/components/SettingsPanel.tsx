import { BookOpen, Brain, Cpu, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { usePanel } from "../app/use-panel";
import type { ProviderId } from "../domain/llm";
import type { UiCopy } from "../i18n/messages";
import type { WebSearchSettings } from "../services/web-search-settings";
import type { SkillDefinition } from "../skills";
import { NativeUpdateSettings } from "../update/NativeUpdateControls";
import type { NativeUpdateState } from "../update/use-native-update";
import { LlmSettingsTab, type LlmProviderEntry } from "./settings/LlmSettingsTab";
import { PreferencesTab } from "./settings/PreferencesTab";
import { SkillsTab } from "./settings/SkillsTab";
import { UserMemoryTab } from "./settings/UserMemoryTab";

export type SettingsTabId = "model" | "preferences" | "memory" | "skills";

export interface SettingsPanelProps {
  copy: UiCopy;
  open: boolean;
  onClose: () => void;
  onOpenOnboarding?: () => void;
  nativeUpdate?: NativeUpdateState;
  initialTab?: SettingsTabId;
  // 模型与服务
  activeProvider?: ProviderId;
  entries: readonly LlmProviderEntry[];
  onLlmSave: (provider: ProviderId, apiKey: string, model: string) => Promise<void>;
  onLlmClear: (provider: ProviderId) => Promise<void>;
  onLlmActivate: (provider: ProviderId) => Promise<void>;
  // 聊天偏好（多气泡与联网搜索）
  multiBubble?: boolean;
  onMultiBubbleChange?: (enabled: boolean) => void;
  webSearchSettings: WebSearchSettings;
  onWebSearchSettingsChange: (partial: Partial<WebSearchSettings>) => void;
  // 长期记忆
  userMemory: string;
  // 技能扩展
  skills: readonly SkillDefinition[];
  activeSkillIds: readonly string[];
  onSkillToggle: (id: string, next: boolean) => void;
}

interface TabItem {
  id: SettingsTabId;
  label: string;
  icon: typeof Cpu;
}

/** 统一设置中心：聚合模型服务、聊天偏好、长期记忆与扩展技能。 */
export function SettingsPanel({
  activeProvider,
  activeSkillIds,
  copy,
  entries,
  initialTab = "model",
  multiBubble = true,
  nativeUpdate,
  onClose,
  onOpenOnboarding,
  onLlmActivate,
  onLlmClear,
  onLlmSave,
  onMultiBubbleChange,
  onSkillToggle,
  onWebSearchSettingsChange,
  open,
  skills,
  userMemory,
  webSearchSettings,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [prevInitialTab, setPrevInitialTab] = useState<SettingsTabId | undefined>(initialTab);

  if (initialTab !== prevInitialTab) {
    setPrevInitialTab(initialTab);
    setActiveTab(initialTab);
  }

  const { render, closing, closeRef, handleKeyDown, panelRef } = usePanel<HTMLDialogElement>(
    open,
    onClose,
  );

  const tabs: readonly TabItem[] = [
    { id: "model", label: copy.llmSettings, icon: Cpu },
    { id: "preferences", label: copy.chatPreferences, icon: SlidersHorizontal },
    { id: "memory", label: copy.userMemoryEntry, icon: Brain },
    { id: "skills", label: copy.skillsTitle, icon: Sparkles },
  ];

  if (!render) return null;

  const selectTab = (id: SettingsTabId): void => {
    setActiveTab(id);
    const body = panelRef.current?.querySelector<HTMLElement>(".settings-panel__body");
    if (body) body.scrollTop = 0;
  };

  return (
    <div className={`overlay overlay--history ${closing ? "overlay--closing" : ""}`}>
      <button
        aria-label={`${copy.closeMenu} ·`}
        className="overlay__backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <dialog
        aria-label={copy.allSettings}
        aria-modal="true"
        className={`settings-panel ${closing ? "settings-panel--closing" : ""}`}
        onKeyDown={handleKeyDown}
        open
        ref={panelRef}
      >
        <header className="settings-panel__header">
          <div className="settings-panel__title-wrap">
            <span>{copy.appName}</span>
            <h1>{copy.allSettings}</h1>
          </div>
          <button
            aria-label={copy.closeMenu}
            className="settings-panel__close-btn"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </header>

        <div aria-label={copy.settings} className="settings-panel__tabs" role="tablist">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                aria-controls={`settings-tabpanel-${tab.id}`}
                aria-selected={isSelected}
                className="settings-panel__tab-btn"
                id={`settings-tab-${tab.id}`}
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => {
                  const index = tabs.findIndex((item) => item.id === tab.id);
                  const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home" ? 0
                    : event.key === "End" ? tabs.length - 1 : undefined;
                  if (nextIndex === undefined) return;
                  event.preventDefault();
                  const nextTab = tabs[nextIndex];
                  selectTab(nextTab.id);
                  event.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(`#settings-tab-${nextTab.id}`)?.focus();
                }}
                role="tab"
                tabIndex={isSelected ? 0 : -1}
                type="button"
              >
                <Icon aria-hidden="true" size={17} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div
          aria-labelledby={`settings-tab-${activeTab}`}
          className="settings-panel__body"
          id={`settings-tabpanel-${activeTab}`}
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "model" ? (
            <LlmSettingsTab
              activeProvider={activeProvider}
              copy={copy}
              entries={entries}
              onActivate={onLlmActivate}
              onClear={onLlmClear}
              onSave={onLlmSave}
            />
          ) : null}

          {activeTab === "preferences" ? (
            <PreferencesTab
              copy={copy}
              multiBubble={multiBubble}
              onMultiBubbleChange={onMultiBubbleChange}
              onWebSearchSettingsChange={onWebSearchSettingsChange}
              webSearchSettings={webSearchSettings}
            />
          ) : null}

          {activeTab === "memory" ? (
            <UserMemoryTab
              copy={copy}
              memory={userMemory}
            />
          ) : null}

          {activeTab === "skills" ? (
            <SkillsTab
              activeIds={activeSkillIds}
              copy={copy}
              onToggle={onSkillToggle}
              skills={skills}
            />
          ) : null}
        </div>
        {onOpenOnboarding || nativeUpdate?.supported ? (
          <footer className="settings-panel__guide">
            {nativeUpdate ? <NativeUpdateSettings copy={copy} update={nativeUpdate} /> : null}
            {onOpenOnboarding ? (
              <button className="settings-panel__guide-btn" onClick={onOpenOnboarding} type="button">
                <BookOpen aria-hidden="true" size={17} />
                {copy.onboardingEntry}
              </button>
            ) : null}
          </footer>
        ) : null}
      </dialog>
    </div>
  );
}
