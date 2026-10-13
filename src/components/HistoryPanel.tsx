import { Check, Pencil, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePanel } from "../app/use-panel";
import type { Conversation } from "../domain/chat";
import {
  createConversationSearchPattern,
  type ConversationSearchResult,
} from "../domain/conversation-search";
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
  onSearch?: (query: string) => Promise<ConversationSearchResult[]>;
}

interface SearchState {
  query: string;
  results: ConversationSearchResult[];
  status: "loading" | "complete" | "failed";
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const match = query ? createConversationSearchPattern(query).exec(text) : null;
  if (!match) return text;
  return <>{text.slice(0, match.index)}<mark>{match[0]}</mark>{text.slice(match.index + match[0].length)}</>;
}

export function HistoryPanel({
  activeId,
  conversations,
  copy,
  onClose,
  onDelete,
  onRename,
  onSelect,
  onSearch,
  open,
}: HistoryPanelProps) {
  const editInputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<SearchState>();
  const normalizedQuery = query.trim();

  const { render, closing, closeRef, handleKeyDown, panelRef } = usePanel<HTMLDialogElement>(
    open,
    onClose,
  );

  useEffect(() => editInputRef.current?.focus(), [editingId]);

  useEffect(() => {
    if (!open || !onSearch || !normalizedQuery) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      setSearch({ query: normalizedQuery, results: [], status: "loading" });
      void Promise.resolve().then(() => onSearch(normalizedQuery)).then(
        (results) => {
          if (active) setSearch({ query: normalizedQuery, results, status: "complete" });
        },
        () => {
          if (active) setSearch({ query: normalizedQuery, results: [], status: "failed" });
        },
      );
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [normalizedQuery, onSearch, open, retry, conversations]);

  const status = !normalizedQuery || !onSearch ? "complete"
    : search?.query === normalizedQuery ? search.status : "loading";
  const results: ConversationSearchResult[] = !normalizedQuery
    ? conversations.map((conversation) => ({ conversation }))
    : onSearch
      ? status === "complete" ? search?.results ?? [] : []
      : conversations.filter(({ title: item }) => createConversationSearchPattern(normalizedQuery).test(item))
        .map((conversation) => ({ conversation }));

  if (!render) return null;

  return (
    <div className={`overlay overlay--history ${closing ? "overlay--closing" : ""}`}>
      {/* 原生 dialog（对齐 MenuDrawer 模式）：交互语义由元素自身提供，无需非交互元素事件 */}
      <dialog
        ref={panelRef}
        open
        aria-label={copy.history}
        aria-modal="true"
        className={`history-panel ${closing ? "history-panel--closing" : ""}`}
        onKeyDown={handleKeyDown}
      >
        <header>
          <h1>{copy.history}</h1>
          <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
            <X aria-hidden="true" size={22} />
          </button>
        </header>
        <div className="history-panel__search">
          <Search aria-hidden="true" size={18} />
          <input
            aria-label={copy.historySearchLabel}
            autoComplete="off"
            maxLength={200}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={copy.historySearchPlaceholder}
            type="search"
            value={query}
          />
          {query ? (
            <button aria-label={copy.historySearchClear} onClick={() => setQuery("")} type="button">
              <X aria-hidden="true" size={18} />
            </button>
          ) : null}
        </div>
        {status === "loading" ? (
          <p className="history-panel__empty" role="status">{copy.historySearching}</p>
        ) : status === "failed" ? (
          <div className="history-panel__search-error" role="status">
            <p>{copy.historySearchFailed}</p>
            <button onClick={() => setRetry((value) => value + 1)} type="button">{copy.historySearchRetry}</button>
          </div>
        ) : results.length === 0 ? (
          <p className="history-panel__empty" role="status">
            {normalizedQuery ? copy.historySearchEmpty : copy.noHistory}
          </p>
        ) : (
          <ol>
            {results.map(({ conversation, message }) => (
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
                      <strong><HighlightedText text={conversation.title} query={normalizedQuery} /></strong>
                      {message ? (
                        <span className="history-panel__excerpt">
                          <HighlightedText text={message.text} query={normalizedQuery} />
                        </span>
                      ) : null}
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
      </dialog>
    </div>
  );
}
