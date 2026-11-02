import { useId } from "react";
import { usePanel } from "../app/use-panel";
import type { Locale } from "../domain/chat";
import type { UiCopy } from "../i18n/messages";
import { ConversationList, type ConversationListProps } from "./conversations/ConversationList";
import type { SettingsTabId } from "./SettingsPanel";
import { DangerFooter } from "./drawer/DangerFooter";
import { DrawerHeader } from "./drawer/DrawerHeader";
import { DrawerNav } from "./drawer/DrawerNav";
import { DrawerQuickActions } from "./drawer/DrawerQuickActions";
import { LanguageSection } from "./drawer/LanguageSection";

export type DrawerConversationsProps = Omit<ConversationListProps, "active" | "copy" | "onSelect"> & {
  onSelect: (id: string) => Promise<void>;
};

export interface MenuDrawerProps {
  copy: UiCopy;
  locale: Locale;
  open: boolean;
  activeModelLabel?: string;
  conversations: DrawerConversationsProps;
  onClearData: () => Promise<void>;
  onClose: () => void;
  onCompress: () => void;
  onLocale: (locale: Locale) => Promise<void>;
  onNewChat: () => Promise<void>;
  onOpenSettings: (tab: SettingsTabId) => void;
  onSignOut: () => Promise<void>;
}

/** 侧边栏抽屉组装层：快捷操作、内嵌会话列表、设置入口、语言与账户操作。 */
export function MenuDrawer({
  activeModelLabel,
  conversations,
  copy,
  locale,
  onClearData,
  onClose,
  onCompress,
  onLocale,
  onNewChat,
  onOpenSettings,
  onSignOut,
  open,
}: MenuDrawerProps) {
  const conversationsTitleId = useId();
  // 解构消费 usePanel 结果：避免编译器把成员访问视为渲染期读 ref
  const { closing, closeRef, handleKeyDown, panelRef, render } = usePanel<HTMLDialogElement>(
    open,
    onClose,
  );

  if (!render) return null;

  const { onSelect, ...listProps } = conversations;

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
        <DrawerHeader
          activeModelLabel={activeModelLabel}
          closeRef={closeRef}
          copy={copy}
          onClose={onClose}
        />
        <DrawerQuickActions copy={copy} onClose={onClose} onCompress={onCompress} onNewChat={onNewChat} />
        <section aria-labelledby={conversationsTitleId} className="drawer__conversations">
          <h2 className="drawer__section-title" id={conversationsTitleId}>{copy.history}</h2>
          <ConversationList
            {...listProps}
            active={open}
            copy={copy}
            onSelect={(id) => {
              onClose();
              void onSelect(id);
            }}
          />
        </section>
        <DrawerNav copy={copy} onClose={onClose} onOpenSettings={onOpenSettings} />
        <LanguageSection copy={copy} locale={locale} onLocale={onLocale} />
        <DangerFooter copy={copy} onClearData={onClearData} onClose={onClose} onSignOut={onSignOut} />
      </dialog>
    </div>
  );
}
