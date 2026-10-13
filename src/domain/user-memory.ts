export interface UserMemoryChangeContext {
  source: "automatic" | "manual" | "message" | "undo";
  conversationId?: string;
  messageId?: string;
}

export interface UserMemoryRevision extends UserMemoryChangeContext {
  id: string;
  createdAt: number;
  before: string;
  after: string;
  memorySourcesBefore?: UserMemorySources;
  memorySourcesAfter?: UserMemorySources;
}

export const MAX_USER_MEMORY_HISTORY = 30;

export interface UserMemorySources {
  independent: string;
  conversations: { conversationId: string; memory: string }[];
}

/** 旧记忆与手动编辑独立保留，自动记忆只归属产生它的会话。 */
export function parseUserMemorySources(value: unknown): UserMemorySources | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.independent !== "string" || !Array.isArray(record.conversations) || record.conversations.length > 30) return undefined;
  const conversations: UserMemorySources["conversations"] = [];
  const ids = new Set<string>();
  for (const entry of record.conversations) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
    const source = entry as Record<string, unknown>;
    if (typeof source.conversationId !== "string" || !source.conversationId || ids.has(source.conversationId) ||
      typeof source.memory !== "string" || [...source.memory].length > 2000) return undefined;
    ids.add(source.conversationId);
    conversations.push({ conversationId: source.conversationId, memory: source.memory });
  }
  return { independent: record.independent, conversations };
}

export function composeUserMemory(sources: UserMemorySources): string {
  if (sources.conversations.length === 0) return sources.independent;
  const lines = [sources.independent, ...sources.conversations.map(({ memory }) => memory)]
    .flatMap((memory) => memory.split("\n").map((line) => line.trim()).filter(Boolean));
  return [...new Set(lines)].join("\n");
}

export function withoutConversationMemory(sources: UserMemorySources, conversationId: string): UserMemorySources {
  return { ...sources, conversations: sources.conversations.filter((source) => source.conversationId !== conversationId) };
}

function parseRevision(value: unknown): UserMemoryRevision | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" || record.id.length === 0 ||
    typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt) ||
    record.createdAt < 0 || record.createdAt > 8.64e15 ||
    typeof record.before !== "string" || typeof record.after !== "string" ||
    (record.source !== "automatic" && record.source !== "manual" && record.source !== "message" && record.source !== "undo") ||
    (record.conversationId !== undefined && (typeof record.conversationId !== "string" || record.conversationId.length === 0)) ||
    (record.messageId !== undefined && (typeof record.messageId !== "string" || record.messageId.length === 0))
  ) return undefined;
  const memorySourcesBefore = parseUserMemorySources(record.memorySourcesBefore);
  const memorySourcesAfter = parseUserMemorySources(record.memorySourcesAfter);
  if ((record.memorySourcesBefore !== undefined || record.memorySourcesAfter !== undefined) &&
    (memorySourcesBefore === undefined || memorySourcesAfter === undefined)) return undefined;
  if (memorySourcesBefore !== undefined && memorySourcesAfter !== undefined &&
    (composeUserMemory(memorySourcesBefore) !== record.before || composeUserMemory(memorySourcesAfter) !== record.after)) return undefined;
  return {
    id: record.id,
    createdAt: record.createdAt,
    before: record.before,
    after: record.after,
    source: record.source,
    ...(record.conversationId === undefined ? {} : { conversationId: record.conversationId }),
    ...(record.messageId === undefined ? {} : { messageId: record.messageId }),
    ...(memorySourcesBefore === undefined ? {} : { memorySourcesBefore, memorySourcesAfter }),
  };
}

/** 数组顺序代表事务提交顺序，不依赖可能回拨的设备时钟。 */
export function parseUserMemoryHistory(value: unknown): UserMemoryRevision[] {
  if (!Array.isArray(value)) return [];
  const revisions: UserMemoryRevision[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const revision = parseRevision(entry);
    if (revision === undefined || ids.has(revision.id)) continue;
    revisions.push(revision);
    ids.add(revision.id);
    if (revisions.length === MAX_USER_MEMORY_HISTORY) break;
  }
  return revisions;
}
