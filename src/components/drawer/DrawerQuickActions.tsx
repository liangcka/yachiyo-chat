import { Archive, MessageSquarePlus } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";

export interface DrawerQuickActionsProps {
  copy: UiCopy;
  onClose: () => void;
  onCompress: () => void;
  onNewChat: () => Promise<void>;
}

/** 当前会话的快捷操作：新建对话与手动压缩上下文。 */
export function DrawerQuickActions({ copy, onClose, onCompress, onNewChat }: DrawerQuickActionsProps) {
  return (
    <div className="drawer__quick-actions">
      <button
        className="drawer__nav-btn drawer__nav-btn--primary"
        onClick={() => {
          onClose();
          void onNewChat();
        }}
        type="button"
      >
        <MessageSquarePlus aria-hidden="true" size={20} />
        <span>{copy.newChat}</span>
      </button>
      <button
        className="drawer__nav-btn"
        onClick={() => {
          onClose();
          onCompress();
        }}
        type="button"
      >
        <Archive aria-hidden="true" size={20} />
        <span>{copy.compressContext}</span>
      </button>
    </div>
  );
}
