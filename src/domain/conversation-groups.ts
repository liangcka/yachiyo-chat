export type ConversationGroupId = "today" | "yesterday" | "previous7Days" | "earlier";

export interface ConversationGroup<T> {
  id: ConversationGroupId;
  items: T[];
}

const groupOrder: readonly ConversationGroupId[] = ["today", "yesterday", "previous7Days", "earlier"];

/** 以本地时区自然日为界，构造日期而非减去固定毫秒数，避免夏令时切换日错位。 */
function startOfLocalDay(timestamp: number, offsetDays = 0): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();
}

/** “最近 7 天”含今天与昨天之外的前五天；时钟回拨导致的未来时间归入今天。 */
export function conversationGroupOf(updatedAt: number, now: number): ConversationGroupId {
  if (updatedAt >= startOfLocalDay(now)) return "today";
  if (updatedAt >= startOfLocalDay(now, -1)) return "yesterday";
  if (updatedAt >= startOfLocalDay(now, -6)) return "previous7Days";
  return "earlier";
}

/** 按最近更新时间分组，组按时间远近排列；组内保持调用方给定的顺序。 */
export function groupByRecency<T>(
  items: readonly T[],
  updatedAtOf: (item: T) => number,
  now: number,
): ConversationGroup<T>[] {
  const buckets = new Map<ConversationGroupId, T[]>();
  for (const item of items) {
    const id = conversationGroupOf(updatedAtOf(item), now);
    const bucket = buckets.get(id);
    if (bucket === undefined) buckets.set(id, [item]);
    else bucket.push(item);
  }
  return groupOrder.flatMap((id) => {
    const grouped = buckets.get(id);
    return grouped === undefined ? [] : [{ id, items: grouped }];
  });
}
