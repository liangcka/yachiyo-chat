import { X } from "lucide-react";
import type { RefObject } from "react";
import type { UiCopy } from "../../i18n/messages";

export interface DrawerHeaderProps {
  closeRef: RefObject<HTMLButtonElement | null>;
  copy: UiCopy;
  onClose: () => void;
}

export function DrawerHeader({ closeRef, copy, onClose }: DrawerHeaderProps) {
  return (
    <header className="drawer__header">
      <div>
        <span>{copy.appName}</span>
        <strong>{copy.settings}</strong>
      </div>
      <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
        <X aria-hidden="true" size={22} />
      </button>
    </header>
  );
}
