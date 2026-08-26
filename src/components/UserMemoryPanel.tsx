import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClosing } from "../app/use-closing";
import type { UiCopy } from "../i18n/messages";

export interface UserMemoryPanelProps {
  copy: UiCopy;
  /** 当前长期记忆内容（跨会话共享） */
  memory: string;
  open: boolean;
  onClose: () => void;
  /** 保存编辑后的长期记忆；失败时返回 false 以便上层提示 */
  onSave: (memory: string) => Promise<boolean>;
}

/** 长期记忆管理面板：查看 / 编辑 / 清除跨会话的用户记忆 */
export function UserMemoryPanel({
  copy,
  memory,
  open,
  onClose,
  onSave,
}: UserMemoryPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(memory);
  // 外部记忆更新时（如压缩提炼），在渲染期间同步草稿，避免 effect 级联渲染
  const [prevMemory, setPrevMemory] = useState(memory);
  if (memory !== prevMemory) {
    setPrevMemory(memory);
    setDraft(memory);
  }

  const { render, closing } = useClosing(open, 300);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!render) return null;

  return (
    <div className={`overlay overlay--history ${closing ? "overlay--closing" : ""}`}>
      <section
        aria-label={copy.userMemoryTitle}
        aria-modal="true"
        className={`skills-panel memory-panel ${closing ? "skills-panel--closing" : ""}`}
        role="dialog"
      >
        <header>
          <h1>{copy.userMemoryTitle}</h1>
          <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
            <X aria-hidden="true" size={22} />
          </button>
        </header>
        <p className="skills-panel__hint">{copy.userMemoryDescription}</p>
        <textarea
          aria-label={copy.userMemoryTitle}
          className="memory-panel__editor"
          onChange={(event) => setDraft(event.target.value)}
          placeholder={copy.userMemoryPlaceholder}
          rows={8}
          value={draft}
        />
        <div className="llm-panel__actions">
          <button
            onClick={() => {
              void onSave(draft);
            }}
            type="button"
          >
            {copy.userMemorySave}
          </button>
          <button
            className="danger-action"
            disabled={draft.trim().length === 0}
            onClick={() => setDraft("")}
            type="button"
          >
            {copy.userMemoryClear}
          </button>
        </div>
      </section>
    </div>
  );
}
