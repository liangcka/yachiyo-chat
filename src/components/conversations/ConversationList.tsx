import { Check, Pencil, Search, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Conversation } from "../../domain/chat";
import { conversationGroupOf, groupByRecency, type ConversationGroupId } from "../../domain/conversation-groups";
import {
  createConversationSearchPattern,
  type ConversationSearchResult,
} from "../../domain/conversation-search";
import type { UiCopy } from "../../i18n/messages";

export interface ConversationListProps {
  activeId?: string;
  /** 所在弹层是否处于打开状态；关闭动画期间丢弃未完成的搜索结果 */
  active: boolean;
  conversations: readonly Conversation[];
  copy: UiCopy;
  /** 分组基准时间，由打开弹层的时刻决定，保证渲染纯净 */
  now: number;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onSelect: (id: string) => void;
  onSearch?: (query: string) => Promise<ConversationSearchResult[]>;
}

interface SearchState {
  query: string;
  results: ConversationSearchResult[];
  status: "loading" | "complete" | "failed";
}

const searchDebounceMs = 150;

function groupLabel(id: ConversationGroupId, copy: UiCopy): string {
  if (id === "today") return copy.conversationGroupToday;
  if (id === "yesterday") return copy.conversationGroupYesterday;
  if (id === "previous7Days") return copy.conversationGroupPrevious7Days;
  return copy.conversationGroupEarlier;
}

function formatUpdatedAt(conversation: Conversation, now: number): string {
  const today = conversationGroupOf(conversation.updatedAt, now) === "today";
  return new Intl.DateTimeFormat(
    conversation.locale,
    today ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short" },
  ).format(conversation.updatedAt);
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const match = query ? createConversationSearchPattern(query).exec(text) : null;
  if (!match) return text;
  return <>{text.slice(0, match.index)}<mark>{match[0]}</mark>{text.slice(match.index + match[0].length)}</>;
}

/** 会话列表：本地全文搜索、按最近更新时间分组，以及行内重命名与二次确认删除。 */
export function ConversationList({
  active,
  activeId,
  conversations,
  copy,
  now,
  onDelete,
  onRename,
  onSearch,
  onSelect,
}: ConversationListProps) {
  const groupIdPrefix = useId();
  const editInputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<SearchState>();
  const normalizedQuery = query.trim();

  useEffect(() => editInputRef.current?.focus(), [editingId]);

  useEffect(() => {
    if (!active || !onSearch || !normalizedQuery) return;
    let current = true;
    const timeout = window.setTimeout(() => {
      setSearch({ query: normalizedQuery, results: [], status: "loading" });
      void Promise.resolve().then(() => onSearch(normalizedQuery)).then(
        (results) => {
          if (current) setSearch({ query: normalizedQuery, results, status: "complete" });
        },
        () => {
          if (current) setSearch({ query: normalizedQuery, results: [], status: "failed" });
        },
      );
    }, searchDebounceMs);
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [active, conversations, normalizedQuery, onSearch, retry]);

  const status = !normalizedQuery || !onSearch ? "complete"
    : search?.query === normalizedQuery ? search.status : "loading";
  const results: ConversationSearchResult[] = !normalizedQuery
    ? conversations.map((conversation) => ({ conversation }))
    : onSearch
      ? status === "complete" ? search?.results ?? [] : []
      : conversations.filter(({ title: item }) => createConversationSearchPattern(normalizedQuery).test(item))
        .map((conversation) => ({ conversation }));
  const groups = groupByRecency(results, ({ conversation }) => conversation.updatedAt, now);

  const renderItem = ({ conversation, message }: ConversationSearchResult) => (
    <li
      className="conversation-list__item"
      data-active={conversation.id === activeId ? "true" : undefined}
      key={conversation.id}
    >
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
            aria-current={conversation.id === activeId ? "true" : undefined}
            className="conversation-list__select"
            onClick={() => onSelect(conversation.id)}
            type="button"
          >
            <strong><HighlightedText text={conversation.title} query={normalizedQuery} /></strong>
            {message ? (
              <span className="conversation-list__excerpt">
                <HighlightedText text={message.text} query={normalizedQuery} />
              </span>
            ) : null}
            <time dateTime={new Date(conversation.updatedAt).toISOString()}>
              {formatUpdatedAt(conversation, now)}
            </time>
          </button>
          <button
            aria-label={copy.rename}
            onClick={() => {
              setDeletingId(undefined);
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
        <div className="conversation-list__confirm">
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
  );

  return (
    <div className="conversation-list">
      <div className="conversation-list__search">
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
      <div className="conversation-list__body">
        {status === "loading" ? (
          <p className="conversation-list__empty" role="status">{copy.historySearching}</p>
        ) : status === "failed" ? (
          <div className="conversation-list__search-error" role="status">
            <p>{copy.historySearchFailed}</p>
            <button onClick={() => setRetry((value) => value + 1)} type="button">{copy.historySearchRetry}</button>
          </div>
        ) : groups.length === 0 ? (
          <p className="conversation-list__empty" role="status">
            {normalizedQuery ? copy.historySearchEmpty : copy.noHistory}
          </p>
        ) : (
          groups.map((group) => (
            <div
              aria-labelledby={`${groupIdPrefix}-${group.id}`}
              className="conversation-list__group"
              key={group.id}
              role="group"
            >
              <h3 className="conversation-list__group-title" id={`${groupIdPrefix}-${group.id}`}>
                {groupLabel(group.id, copy)}
              </h3>
              <ol>{group.items.map(renderItem)}</ol>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
