import { usePanel } from "../app/use-panel";
import type { Locale } from "../domain/chat";
import type { UiCopy } from "../i18n/messages";
import { DangerFooter } from "./drawer/DangerFooter";
import { DrawerHeader } from "./drawer/DrawerHeader";
import { DrawerNav } from "./drawer/DrawerNav";
import { LanguageSection } from "./drawer/LanguageSection";

export interface MenuDrawerProps {
  copy: UiCopy;
  locale: Locale;
  open: boolean;
  onClearData: () => Promise<void>;
  onClose: () => void;
  onHistory: () => void;
  onLocale: (locale: Locale) => Promise<void>;
  onLlmSettings: () => void;
  onNewChat: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSkills: () => void;
  onCompress: () => void;
  onUserMemory: () => void;
}

/** 侧边栏抽屉组装层：布局、弹层基础设施与各功能分区。 */
export function MenuDrawer({
  copy,
  locale,
  onClearData,
  onClose,
  onHistory,
  onLocale,
  onLlmSettings,
  onNewChat,
  onSignOut,
  onSkills,
  onCompress,
  onUserMemory,
  open,
}: MenuDrawerProps) {
  // 解构消费 usePanel 结果（与 HistoryPanel 一致）：避免编译器把成员访问视为渲染期读 ref
  const { closing, closeRef, handleKeyDown, panelRef, render } = usePanel<HTMLDialogElement>(
    open,
    onClose,
  );

  if (!render) return null;

  return (
    <div className={`overlay ${closing ? "overlay--closing" : ""}`}>
      <button
        aria-label={`${copy.closeMenu} ·`}
        className="overlay__backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <dialog
        ref={panelRef}
        open
        aria-label={copy.menu}
        aria-modal="true"
        className={`drawer ${closing ? "drawer--closing" : ""}`}
        onKeyDown={handleKeyDown}
      >
        <DrawerHeader closeRef={closeRef} copy={copy} onClose={onClose} />
        <DrawerNav
          copy={copy}
          onClose={onClose}
          onCompress={onCompress}
          onHistory={onHistory}
          onLlmSettings={onLlmSettings}
          onNewChat={onNewChat}
          onSkills={onSkills}
          onUserMemory={onUserMemory}
        />
        <LanguageSection copy={copy} locale={locale} onLocale={onLocale} />
        <DangerFooter copy={copy} onClearData={onClearData} onClose={onClose} onSignOut={onSignOut} />
      </dialog>
    </div>
  );
}
