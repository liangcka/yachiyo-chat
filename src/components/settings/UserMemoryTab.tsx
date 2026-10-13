import type { UiCopy } from "../../i18n/messages";

export interface UserMemoryTabProps {
  copy: UiCopy;
  memory: string;
}

/** 只读展示跨会话共享的记忆。 */
export function UserMemoryTab({ copy, memory }: UserMemoryTabProps) {
  return (
    <div className="settings-tab-content">
      <p className="skills-panel__hint">{copy.userMemoryDescription}</p>
      <p className="memory-panel__editor settings-memory__content">
        {memory.trim() ? memory : copy.userMemoryPlaceholder}
      </p>
    </div>
  );
}
