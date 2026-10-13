import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { UiCopy } from "../../i18n/messages";
import type { SkillDefinition } from "../../skills";

export interface SkillsTabProps {
  copy: UiCopy;
  skills: readonly SkillDefinition[];
  activeIds: readonly string[];
  onToggle: (id: string, next: boolean) => void;
}

/** 扩展技能分栏：展示并配置八千代预置技能。 */
export function SkillsTab({ activeIds, copy, onToggle, skills }: SkillsTabProps) {
  const [expandedId, setExpandedId] = useState<string>();

  return (
    <div className="settings-tab-content">
      <p className="skills-panel__hint">{copy.skillsDescription}</p>
      {skills.length === 0 && <p className="skills-panel__hint">{copy.skillsEmpty}</p>}

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
                      aria-controls={`settings-skill-content-${skill.id}`}
                      aria-label={`${expanded ? copy.skillHideContent : copy.skillViewContent}: ${skill.name}`}
                      className="skills-panel__expand"
                      onClick={() => setExpandedId(expanded ? undefined : skill.id)}
                      type="button"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        data-expanded={expanded ? "true" : undefined}
                        size={14}
                      />
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
              {expanded ? <pre className="skills-panel__content" id={`settings-skill-content-${skill.id}`}>{skill.content}</pre> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
