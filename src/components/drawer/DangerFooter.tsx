import { LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import type { UiCopy } from "../../i18n/messages";

export interface DangerFooterProps {
  copy: UiCopy;
  onClearData: () => Promise<void>;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}

/** 危险操作区：清除数据（含二次确认）与退出登录。 */
export function DangerFooter({ copy, onClearData, onClose, onSignOut }: DangerFooterProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (confirmingClear) {
    return (
      <section className="drawer__confirm" aria-live="polite">
        <p>{copy.clearDataConfirm}</p>
        <div>
          <button onClick={() => setConfirmingClear(false)} type="button">
            {copy.cancel}
          </button>
          <button
            className="danger-action"
            onClick={() => {
              setConfirmingClear(false);
              onClose();
              void onClearData();
            }}
            type="button"
          >
            {copy.confirm}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="drawer__footer">
      <button className="danger-action" onClick={() => setConfirmingClear(true)} type="button">
        <Trash2 aria-hidden="true" size={19} />
        <span>{copy.clearData}</span>
      </button>
      <button
        onClick={() => {
          onClose();
          void onSignOut();
        }}
        type="button"
      >
        <LogOut aria-hidden="true" size={19} />
        <span>{copy.signOut}</span>
      </button>
    </div>
  );
}
