import { Brain, Cpu, Settings, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import { useId } from "react";
import type { UiCopy } from "../../i18n/messages";
import type { SettingsTabId } from "../SettingsPanel";

export interface DrawerNavProps {
  copy: UiCopy;
  onClose: () => void;
  onOpenSettings: (tab: SettingsTabId) => void;
}

const settingsEntries: ReadonlyArray<{
  tab: SettingsTabId;
  icon: LucideIcon;
  label: (copy: UiCopy) => string;
}> = [
  { tab: "model", icon: Cpu, label: (copy) => copy.llmSettingsEntry },
  { tab: "preferences", icon: SlidersHorizontal, label: (copy) => copy.chatPreferences },
  { tab: "memory", icon: Brain, label: (copy) => copy.userMemoryEntry },
  { tab: "skills", icon: Sparkles, label: (copy) => copy.skillsEntry },
];

/** 设置入口：每项直达设置中心对应分页，跳转前先收起抽屉。 */
export function DrawerNav({ copy, onClose, onOpenSettings }: DrawerNavProps) {
  const titleId = useId();
  const open = (tab: SettingsTabId) => () => {
    onClose();
    onOpenSettings(tab);
  };

  return (
    <nav aria-labelledby={titleId} className="drawer__nav">
      <div className="drawer__section-header">
        <span className="drawer__section-title" id={titleId}>{copy.settingsSectionTitle}</span>
        <button
          aria-label={copy.allSettings}
          className="drawer__section-all-btn"
          onClick={open("model")}
          type="button"
        >
          <Settings aria-hidden="true" size={15} />
          <span>{copy.allSettings}</span>
        </button>
      </div>
      <div className="drawer__section-items drawer__section-items--grid">
        {settingsEntries.map(({ tab, icon: Icon, label }) => (
          <button className="drawer__nav-btn" key={tab} onClick={open(tab)} type="button">
            <Icon aria-hidden="true" size={20} />
            <span>{label(copy)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
