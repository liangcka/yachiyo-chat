import { useCallback, useEffect, useMemo, useState } from "react";
import type { Conversation } from "../domain/chat";
import type { ConversationSearchResult } from "../domain/conversation-search";
import type { AppRepository } from "./app-services";

export interface ConversationListOptions {
  repository: Pick<AppRepository, "listConversations" | "renameConversation" | "searchConversations">;
  /** 未通过门禁时不读取历史 */
  enabled: boolean;
  /** 活跃会话切换或标题更新时需要重新拉取列表 */
  activeConversation?: Pick<Conversation, "id" | "title">;
  onStorageError: () => void;
}

export interface ConversationList {
  items: Conversation[];
  refresh(): Promise<void>;
  search?: (query: string) => Promise<ConversationSearchResult[]>;
  rename(id: string, title: string): Promise<void>;
}

export function useConversationList({
  repository,
  enabled,
  activeConversation,
  onStorageError,
}: ConversationListOptions): ConversationList {
  const [items, setItems] = useState<Conversation[]>([]);
  const activeId = activeConversation?.id;
  const activeTitle = activeConversation?.title;

  const refresh = useCallback(async () => {
    try {
      setItems(await repository.listConversations());
    } catch {
      onStorageError();
    }
  }, [onStorageError, repository]);

  const search = useMemo(() => {
    const searchConversations = repository.searchConversations?.bind(repository);
    return searchConversations === undefined
      ? undefined
      : (query: string) => searchConversations(query);
  }, [repository]);

  const rename = useCallback(async (id: string, title: string) => {
    await repository.renameConversation(id, title);
    await refresh();
  }, [refresh, repository]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void repository.listConversations()
      .then((conversations) => {
        if (!cancelled) setItems(conversations);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId, activeTitle, enabled, repository]);

  return { items, refresh, search, rename };
}
