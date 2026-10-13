import { Globe, MessageSquare, Search, Sparkles } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";
import type { WebSearchSettings } from "../../services/web-search-settings";

export interface PreferencesTabProps {
  copy: UiCopy;
  /** 多气泡消息开关状态，默认开启 */
  multiBubble?: boolean;
  /** 切换多气泡消息设置 */
  onMultiBubbleChange?: (enabled: boolean) => void;
  /** 联网搜索设置 */
  webSearchSettings: WebSearchSettings;
  /** 切换联网搜索设置 */
  onWebSearchSettingsChange: (partial: Partial<WebSearchSettings>) => void;
}

interface PreferenceCardProps {
  title: string;
  description: string;
  active: boolean;
  disabled?: boolean;
  isSubitem?: boolean;
  icon?: typeof MessageSquare;
  toggleLabel: string;
  disableLabel: string;
  enableLabel: string;
  onToggle: () => void;
}

function PreferenceCard({
  active,
  description,
  disabled = false,
  disableLabel,
  enableLabel,
  icon: Icon,
  isSubitem = false,
  onToggle,
  title,
  toggleLabel,
}: PreferenceCardProps) {
  const cardClassName = `preference-card${isSubitem ? " preference-card--subitem" : ""}`;

  return (
    <li className={cardClassName} data-active={active ? "true" : undefined}>
      <div className="preference-card__content">
        {Icon ? (
          <div aria-hidden="true" className="preference-card__icon-badge">
            <Icon size={19} />
          </div>
        ) : null}
        <div className="preference-card__meta">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
      </div>
      <button
        aria-label={`${toggleLabel}: ${title}`}
        aria-pressed={active}
        className="preference-card__toggle"
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        {active ? disableLabel : enableLabel}
      </button>
    </li>
  );
}

/** 聊天偏好与功能设置分栏：分条发送消息与联网搜索选项。 */
export function PreferencesTab({
  copy,
  multiBubble = true,
  onMultiBubbleChange,
  onWebSearchSettingsChange,
  webSearchSettings,
}: PreferencesTabProps) {
  const { enabled, showSources, smart } = webSearchSettings;

  return (
    <div className="settings-tab-content">
      <p className="skills-panel__hint">{copy.chatPreferencesDescription}</p>

      <ul className="preferences-list">
        <PreferenceCard
          active={multiBubble}
          description={copy.multiBubbleDescription}
          disableLabel={copy.skillDisable}
          enableLabel={copy.skillEnable}
          icon={MessageSquare}
          onToggle={() => onMultiBubbleChange?.(!multiBubble)}
          title={copy.multiBubbleTitle}
          toggleLabel={copy.skillToggleLabel}
        />

        <PreferenceCard
          active={enabled}
          description={copy.webSearchDescription}
          disableLabel={copy.skillDisable}
          enableLabel={copy.skillEnable}
          icon={Globe}
          onToggle={() => onWebSearchSettingsChange({ enabled: !enabled })}
          title={copy.webSearchTitle}
          toggleLabel={copy.skillToggleLabel}
        />

        <PreferenceCard
          active={smart}
          description={copy.webSearchSmartDescription}
          disabled={!enabled}
          disableLabel={copy.skillDisable}
          enableLabel={copy.skillEnable}
          icon={Sparkles}
          isSubitem
          onToggle={() => onWebSearchSettingsChange({ smart: !smart })}
          title={copy.webSearchSmart}
          toggleLabel={copy.skillToggleLabel}
        />

        <PreferenceCard
          active={showSources}
          description={copy.webSearchShowSourcesDescription}
          disabled={!enabled}
          disableLabel={copy.skillDisable}
          enableLabel={copy.skillEnable}
          icon={Search}
          isSubitem
          onToggle={() => onWebSearchSettingsChange({ showSources: !showSources })}
          title={copy.webSearchShowSources}
          toggleLabel={copy.skillToggleLabel}
        />
      </ul>
    </div>
  );
}
