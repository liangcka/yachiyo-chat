import { Check, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePanel } from "../app/use-panel";
import type { Conversation } from "../domain/chat";
import type { UiCopy } from "../i18n/messages";

export interface HistoryPanelProps {
  activeId?: string;
  conversations: Conversation[];
  copy: UiCopy;
  open: boolean;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
}

export function HistoryPanel({
  activeId,
  conversations,
  copy,
  onClose,
  onDelete,
  onRename,
  onSelect,
  open,
}: HistoryPanelProps) {
  const editInputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState("");

  const { render, closing, closeRef, panelRef, handleKeyDown } = usePanel(open, onClose);

  useEffect(() => editInputRef.current?.focus(), [editingId]);

  if (!render) return null;

  return (
    <div className={`overlay overlay--history ${closing ? "overlay--closing" : ""}`}>
      <section
        ref={panelRef}
        aria-label={copy.history}
        aria-modal="true"
        className={`history-panel ${closing ? "history-panel--closing" : ""}`}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <header>
          <h1>{copy.history}</h1>
          <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
            <X aria-hidden="true" size={22} />
          </button>
        </header>
        {conversations.length === 0 ? (
          <p className="history-panel__empty">{copy.noHistory}</p>
        ) : (
          <ol>
            {conversations.map((conversation) => (
              <li data-active={conversation.id === activeId ? "true" : undefined} key={conversation.id}>
                {editingId === conversation.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const normalized = title.trim();
                      if (normalized.length === 0) return;
                      void onRename(conversation.id, normalized).then(() => setEditingId(undefined));
                    }}
                  >
                    <input
                      ref={editInputRef}
                      aria-label={`${copy.rename}: ${conversation.title}`}
                      maxLength={80}
                      onChange={(event) => setTitle(event.currentTarget.value)}
                      value={title}
                    />
                    <button aria-label={copy.confirm} type="submit">
                      <Check aria-hidden="true" size={18} />
                    </button>
                    <button aria-label={copy.cancel} onClick={() => setEditingId(undefined)} type="button">
                      <X aria-hidden="true" size={18} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="history-panel__select"
                      onClick={() => {
                        onClose();
                        void onSelect(conversation.id);
                      }}
                      type="button"
                    >
                      <strong>{conversation.title}</strong>
                      <time dateTime={new Date(conversation.updatedAt).toISOString()}>
                        {new Intl.DateTimeFormat(conversation.locale, {
                          day: "2-digit",
                          month: "short",
                        }).format(conversation.updatedAt)}
                      </time>
                    </button>
                    <button
                      aria-label={copy.rename}
                      onClick={() => {
                        setEditingId(conversation.id);
                        setTitle(conversation.title);
                      }}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={18} />
                    </button>
                    <button
                      aria-label={copy.delete}
                      onClick={() => setDeletingId(conversation.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={18} />
                    </button>
                  </>
                )}
                {deletingId === conversation.id ? (
                  <div className="history-panel__confirm">
                    <p>{copy.deleteConfirm}</p>
                    <button onClick={() => setDeletingId(undefined)} type="button">
                      {copy.cancel}
                    </button>
                    <button
                      className="danger-action"
                      onClick={() => {
                        setDeletingId(undefined);
                        void onDelete(conversation.id);
                      }}
                      type="button"
                    >
                      {copy.confirm}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
