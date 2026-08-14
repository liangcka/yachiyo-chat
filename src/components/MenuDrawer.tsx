import { Archive, Cpu, History, Languages, LogOut, MessageSquarePlus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useClosing } from "../app/use-closing";
import type { Locale } from "../domain/chat";
import type { UiCopy } from "../i18n/messages";

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
  onCompress: () => void;
}

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
  onCompress,
  open,
}: MenuDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const { render, closing } = useClosing(open, 300);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [open]);

  if (!render) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

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
        ref={dialogRef}
        open
        aria-label={copy.menu}
        aria-modal="true"
        className={`drawer ${closing ? "drawer--closing" : ""}`}
        onKeyDown={handleKeyDown}
      >
        <header className="drawer__header">
          <div>
            <span>{copy.appName}</span>
            <strong>{copy.settings}</strong>
          </div>
          <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
            <X aria-hidden="true" size={22} />
          </button>
        </header>

        <nav className="drawer__actions">
          <button
            onClick={() => {
              onClose();
              void onNewChat();
            }}
            type="button"
          >
            <MessageSquarePlus aria-hidden="true" size={21} />
            <span>{copy.newChat}</span>
          </button>
          <button onClick={onHistory} type="button">
            <History aria-hidden="true" size={21} />
            <span>{copy.history}</span>
          </button>
          <button
            onClick={() => {
              onClose();
              onCompress();
            }}
            type="button"
          >
            <Archive aria-hidden="true" size={21} />
            <span>{copy.compressContext}</span>
          </button>
          <button
            onClick={() => {
              onClose();
              onLlmSettings();
            }}
            type="button"
          >
            <Cpu aria-hidden="true" size={21} />
            <span>{copy.llmSettingsEntry}</span>
          </button>
        </nav>

        <section className="drawer__language" aria-labelledby="language-title">
          <h2 id="language-title">
            <Languages aria-hidden="true" size={19} />
            {copy.localeLabel}
          </h2>
          <div>
            <button
              aria-pressed={locale === "zh-CN"}
              onClick={() => void onLocale("zh-CN")}
              type="button"
            >
              {copy.chinese}
            </button>
            <button
              aria-pressed={locale === "ja-JP"}
              onClick={() => void onLocale("ja-JP")}
              type="button"
            >
              {copy.japanese}
            </button>
          </div>
        </section>

        {confirmingClear ? (
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
        ) : (
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
        )}
      </dialog>
    </div>
  );
}
