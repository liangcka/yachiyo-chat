import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClosing } from "../app/use-closing";
import { type SkillDefinition } from "../skills";
import type { UiCopy } from "../i18n/messages";

export interface SkillsPanelProps {
  copy: UiCopy;
  skills: readonly SkillDefinition[];
  activeIds: readonly string[];
  open: boolean;
  onClose: () => void;
  onToggle: (id: string, next: boolean) => void;
  /** 联网搜索开关状态 */
  webSearchEnabled: boolean;
  /** "显示引用来源"开关状态 */
  webSearchShowSources: boolean;
  /** "智能搜索"开关状态 */
  webSearchSmart: boolean;
  /** 切换联网搜索开关 */
  onWebSearchEnabledChange: (next: boolean) => void;
  /** 切换"显示引用来源"开关 */
  onWebSearchShowSourcesChange: (next: boolean) => void;
  /** 切换"智能搜索"开关 */
  onWebSearchSmartChange: (next: boolean) => void;
}

export function SkillsPanel({
  copy,
  skills,
  activeIds,
  open,
  onClose,
  onToggle,
  webSearchEnabled,
  webSearchShowSources,
  webSearchSmart,
  onWebSearchEnabledChange,
  onWebSearchShowSourcesChange,
  onWebSearchSmartChange,
}: SkillsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [expandedId, setExpandedId] = useState<string>();

  const { render, closing } = useClosing(open, 300);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!render) return null;

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
                    <strong>{skill.name}</strong>
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
                <button
                  aria-expanded={expanded}
                  className="skills-panel__expand"
                  onClick={() => setExpandedId(expanded ? undefined : skill.id)}
                  type="button"
                >
                  <ChevronDown aria-hidden="true" data-expanded={expanded ? "true" : undefined} size={18} />
                  <span>{expanded ? copy.skillHideContent : copy.skillViewContent}</span>
                </button>
                {expanded ? <pre className="skills-panel__content">{skill.content}</pre> : null}
              </li>
            );
          })}
        </ul>
        <ul className="skills-panel__list skills-panel__web-search">
          <li
            className="skills-panel__item skills-panel__web-search-item"
            data-active={webSearchEnabled ? "true" : undefined}
          >
            <div className="skills-panel__summary">
              <div className="skills-panel__meta">
                <strong>{copy.webSearchTitle}</strong>
                <span>{copy.webSearchDescription}</span>
              </div>
              <button
                aria-label={`${copy.skillToggleLabel}: ${copy.webSearchTitle}`}
                aria-pressed={webSearchEnabled}
                className="skills-panel__toggle"
                onClick={() => onWebSearchEnabledChange(!webSearchEnabled)}
                type="button"
              >
                {webSearchEnabled ? copy.skillDisable : copy.skillEnable}
              </button>
            </div>
          </li>
          <li
            className="skills-panel__item skills-panel__web-search-item"
            data-active={webSearchEnabled && webSearchSmart ? "true" : undefined}
          >
            <div className="skills-panel__summary">
              <div className="skills-panel__meta">
                <strong>{copy.webSearchSmart}</strong>
                <span>{copy.webSearchSmartDescription}</span>
              </div>
              <button
                aria-label={`${copy.skillToggleLabel}: ${copy.webSearchSmart}`}
                aria-pressed={webSearchSmart}
                className="skills-panel__toggle"
                disabled={!webSearchEnabled}
                onClick={() => onWebSearchSmartChange(!webSearchSmart)}
                type="button"
              >
                {webSearchSmart ? copy.skillDisable : copy.skillEnable}
              </button>
            </div>
          </li>
          <li
            className="skills-panel__item skills-panel__web-search-item"
            data-active={webSearchEnabled && webSearchShowSources ? "true" : undefined}
          >
            <div className="skills-panel__summary">
              <div className="skills-panel__meta">
                <strong>{copy.webSearchShowSources}</strong>
                <span>{copy.webSearchShowSourcesDescription}</span>
              </div>
              <button
                aria-label={`${copy.skillToggleLabel}: ${copy.webSearchShowSources}`}
                aria-pressed={webSearchShowSources}
                className="skills-panel__toggle"
                disabled={!webSearchEnabled}
                onClick={() => onWebSearchShowSourcesChange(!webSearchShowSources)}
                type="button"
              >
                {webSearchShowSources ? copy.skillDisable : copy.skillEnable}
              </button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
