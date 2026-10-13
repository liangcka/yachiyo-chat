import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useClosing } from "../app/use-closing";
import type { UserMemoryRevision } from "../domain/user-memory";
import type { UiCopy } from "../i18n/messages";
import { UserMemoryEditor } from "./UserMemoryEditor";

export interface UserMemoryPanelProps {
  copy: UiCopy;
  /** 当前长期记忆内容（跨会话共享） */
  memory: string;
  open: boolean;
  onClose: () => void;
  /** 保存编辑后的长期记忆；失败时返回 false 以便上层提示 */
  onSave: (memory: string) => Promise<boolean>;
  history?: readonly UserMemoryRevision[];
  onUndo?: (revisionId: string) => Promise<boolean>;
}

/** 长期记忆管理面板：查看 / 编辑 / 清除跨会话的用户记忆 */
export function UserMemoryPanel({
  copy,
  history,
  memory,
  open,
  onClose,
  onSave,
  onUndo,
}: UserMemoryPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

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
        <UserMemoryEditor copy={copy} history={history} memory={memory} onSave={onSave} onUndo={onUndo} />
      </section>
    </div>
  );
}
