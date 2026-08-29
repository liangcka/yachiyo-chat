import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClosing } from "../app/use-closing";
import type { UiCopy } from "../i18n/messages";
import type { WebSearchSettings } from "../services/web-search-settings";
import { type SkillDefinition } from "../skills";

export interface SkillsPanelProps {
  copy: UiCopy;
  skills: readonly SkillDefinition[];
  activeIds: readonly string[];
  open: boolean;
  onClose: () => void;
  onToggle: (id: string, next: boolean) => void;
  /** 联网搜索开关状态 */
  webSearchSettings: WebSearchSettings;
  /** 切换联网搜索设置 */
  onWebSearchSettingsChange: (partial: Partial<WebSearchSettings>) => void;
}

interface WebSearchItemProps {
  title: string;
  description: string;
  active: boolean;
  dataActive?: boolean;
  disabled?: boolean;
  isSubitem?: boolean;
  toggleLabel: string;
  disableLabel: string;
  enableLabel: string;
  onToggle: () => void;
}

function WebSearchItem({
  title,
  description,
  active,
  dataActive,
  disabled = false,
  isSubitem = false,
  toggleLabel,
  disableLabel,
  enableLabel,
  onToggle,
}: WebSearchItemProps) {
  const itemClassName = `skills-panel__item skills-panel__web-search-item${
    isSubitem ? " skills-panel__web-search-subitem" : ""
  }`;
  const isDataActive = dataActive ?? active;

  return (
    <li className={itemClassName} data-active={isDataActive ? "true" : undefined}>
      <div className="skills-panel__summary">
        <div className="skills-panel__meta">
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <button
          aria-label={`${toggleLabel}: ${title}`}
          aria-pressed={active}
          className="skills-panel__toggle"
          disabled={disabled}
          onClick={onToggle}
          type="button"
        >
          {active ? disableLabel : enableLabel}
        </button>
      </div>
    </li>
  );
}

export function SkillsPanel({
  copy,
  skills,
  activeIds,
  open,
  onClose,
  onToggle,
  webSearchSettings,
  onWebSearchSettingsChange,
}: SkillsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [expandedId, setExpandedId] = useState<string>();

  const { render, closing } = useClosing(open, 300);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!render) return null;

  const { enabled, showSources, smart } = webSearchSettings;

  return (
    <div className={`overlay overlay--history ${closing ? "overlay--closing" : ""}`}>
      <section
        aria-label={copy.skillsTitle}
        aria-modal="true"
        className={`skills-panel ${closing ? "skills-panel--closing" : ""}`}
        role="dialog"
      >
        <header>
          <h1>{copy.skillsTitle}</h1>
          <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
            <X aria-hidden="true" size={22} />
          </button>
        </header>
        <p className="skills-panel__hint">{copy.skillsDescription}</p>
        <ul className="skills-panel__list">
          {skills.map((skill) => {
            const active = activeIds.includes(skill.id);
            const expanded = expandedId === skill.id;
            return (
              <li
                className="skills-panel__item"
                data-active={active ? "true" : undefined}
                key={skill.id}
              >
                <div className="skills-panel__summary">
                  <div className="skills-panel__meta">
                    <div className="skills-panel__title-row">
                      <strong>{skill.name}</strong>
                      <button
                        aria-expanded={expanded}
                        className="skills-panel__expand"
                        onClick={() => setExpandedId(expanded ? undefined : skill.id)}
                        type="button"
                      >
                        <ChevronDown aria-hidden="true" data-expanded={expanded ? "true" : undefined} size={14} />
                        <span>{expanded ? copy.skillHideContent : copy.skillViewContent}</span>
                      </button>
                    </div>
                    <span>{skill.description}</span>
                  </div>
                  <button
                    aria-label={`${copy.skillToggleLabel}: ${skill.name}`}
                    aria-pressed={active}
                    className="skills-panel__toggle"
                    onClick={() => onToggle(skill.id, !active)}
                    type="button"
                  >
                    {active ? copy.skillDisable : copy.skillEnable}
                  </button>
                </div>
                {expanded ? <pre className="skills-panel__content">{skill.content}</pre> : null}
              </li>
            );
          })}
        </ul>
        <ul className="skills-panel__list skills-panel__web-search">
          <WebSearchItem
            active={enabled}
            disableLabel={copy.skillDisable}
            description={copy.webSearchDescription}
            enableLabel={copy.skillEnable}
            onToggle={() => onWebSearchSettingsChange({ enabled: !enabled })}
            title={copy.webSearchTitle}
            toggleLabel={copy.skillToggleLabel}
          />
          <WebSearchItem
            active={smart}
            dataActive={enabled && smart}
            disabled={!enabled}
            disableLabel={copy.skillDisable}
            description={copy.webSearchSmartDescription}
            enableLabel={copy.skillEnable}
            isSubitem
            onToggle={() => onWebSearchSettingsChange({ smart: !smart })}
            title={copy.webSearchSmart}
            toggleLabel={copy.skillToggleLabel}
          />
          <WebSearchItem
            active={showSources}
            dataActive={enabled && showSources}
            disabled={!enabled}
            disableLabel={copy.skillDisable}
            description={copy.webSearchShowSourcesDescription}
            enableLabel={copy.skillEnable}
            isSubitem
            onToggle={() => onWebSearchSettingsChange({ showSources: !showSources })}
            title={copy.webSearchShowSources}
            toggleLabel={copy.skillToggleLabel}
          />
        </ul>
      </section>
    </div>
  );
}
