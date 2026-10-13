import {
  Archive,
  Brain,
  Cpu,
  History,
  MessageSquarePlus,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import type { SettingsTabId } from "../SettingsPanel";

export interface DrawerNavProps {
  copy: UiCopy;
  onClose: () => void;
  onCompress: () => void;
  onHistory: () => void;
  onLlmSettings: () => void;
  onNewChat: () => Promise<void>;
  onSkills: () => void;
  onUserMemory: () => void;
  onPreferences?: () => void;
  onOpenSettings?: (tab?: SettingsTabId) => void;
}

/** 抽屉导航入口：按“会话管理”与“功能偏好”分组，统一处理抽屉关闭与目标跳转。 */
export function DrawerNav({
  copy,
  onClose,
  onCompress,
  onHistory,
  onLlmSettings,
  onNewChat,
  onOpenSettings,
  onPreferences,
  onSkills,
  onUserMemory,
}: DrawerNavProps) {
  const closeThen = (action: () => void) => () => {
    onClose();
    action();
  };

  const handleOpenMainSettings = onOpenSettings ? () => onOpenSettings("model") : onLlmSettings;
  const handleOpenPreferences = onPreferences ?? onSkills;

  return (
    <nav aria-label={copy.menu} className="drawer__nav">
      <div className="drawer__nav-section">
        <span className="drawer__section-title">{copy.sessionSectionTitle}</span>
        <div className="drawer__section-items">
          <button
            className="drawer__nav-btn"
            onClick={closeThen(() => void onNewChat())}
            type="button"
          >
            <MessageSquarePlus aria-hidden="true" size={20} />
            <span>{copy.newChat}</span>
          </button>
          <button className="drawer__nav-btn" onClick={closeThen(onHistory)} type="button">
            <History aria-hidden="true" size={20} />
            <span>{copy.history}</span>
          </button>
          <button className="drawer__nav-btn" onClick={closeThen(onCompress)} type="button">
            <Archive aria-hidden="true" size={20} />
            <span>{copy.compressContext}</span>
          </button>
        </div>
      </div>

      <div className="drawer__nav-section">
        <div className="drawer__section-header">
          <span className="drawer__section-title">{copy.settingsSectionTitle}</span>
          <button
            aria-label={copy.allSettings}
            className="drawer__section-all-btn"
            onClick={closeThen(handleOpenMainSettings)}
            type="button"
          >
            <Settings aria-hidden="true" size={15} />
            <span>{copy.allSettings}</span>
          </button>
        </div>
        <div className="drawer__section-items">
          <button
            className="drawer__nav-btn"
            onClick={closeThen(onLlmSettings)}
            type="button"
          >
            <Cpu aria-hidden="true" size={20} />
            <span>{copy.llmSettingsEntry}</span>
          </button>
          <button
            className="drawer__nav-btn"
            onClick={closeThen(handleOpenPreferences)}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" size={20} />
            <span>{copy.chatPreferences}</span>
          </button>
          <button
            className="drawer__nav-btn"
            onClick={closeThen(onUserMemory)}
            type="button"
          >
            <Brain aria-hidden="true" size={20} />
            <span>{copy.userMemoryEntry}</span>
          </button>
          <button
            className="drawer__nav-btn"
            onClick={closeThen(onSkills)}
            type="button"
          >
            <Sparkles aria-hidden="true" size={20} />
            <span>{copy.skillsEntry}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
