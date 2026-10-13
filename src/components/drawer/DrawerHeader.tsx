import { X } from "lucide-react";
import type { RefObject } from "react";
import type { UiCopy } from "../../i18n/messages";

export interface DrawerHeaderProps {
  closeRef: RefObject<HTMLButtonElement | null>;
  copy: UiCopy;
  onClose: () => void;
  activeModelLabel?: string;
}

/** 抽屉顶部标头：应用标识、当前生效模型微标与关闭按钮。 */
export function DrawerHeader({
  activeModelLabel,
  closeRef,
  copy,
  onClose,
}: DrawerHeaderProps) {
  return (
    <header className="drawer__header">
      <div className="drawer__header-titles">
        <span>{copy.appName}</span>
        <strong>{copy.settings}</strong>
        {activeModelLabel ? (
          <div className="drawer__model-badge" title={`${copy.activeModelLabel}: ${activeModelLabel}`}>
            <span aria-hidden="true" className="drawer__model-badge-dot" />
            <span className="drawer__model-badge-text">{activeModelLabel}</span>
          </div>
        ) : null}
      </div>
      <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
        <X aria-hidden="true" size={22} />
      </button>
    </header>
  );
}
