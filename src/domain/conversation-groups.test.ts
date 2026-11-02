import { describe, expect, it } from "vitest";
import { conversationGroupOf, groupByRecency } from "./conversation-groups";

const now = new Date(2026, 9, 31, 15, 30).getTime();
const startOf = (day: number) => new Date(2026, 9, day).getTime();

describe("会话日期分组", () => {
  it("以本地自然日为界划分今天、昨天、最近 7 天与更早", () => {
    expect(conversationGroupOf(startOf(31), now)).toBe("today");
    expect(conversationGroupOf(startOf(31) - 1, now)).toBe("yesterday");
    expect(conversationGroupOf(startOf(30), now)).toBe("yesterday");
    expect(conversationGroupOf(startOf(30) - 1, now)).toBe("previous7Days");
    expect(conversationGroupOf(startOf(25), now)).toBe("previous7Days");
    expect(conversationGroupOf(startOf(25) - 1, now)).toBe("earlier");
  });

  it("时钟回拨产生的未来时间归入今天", () => {
    expect(conversationGroupOf(now + 86_400_000, now)).toBe("today");
  });

  it("按时间远近输出非空分组，组内保持输入顺序", () => {
    const items = [
      { id: "old", updatedAt: startOf(1) },
      { id: "today-late", updatedAt: now },
      { id: "today-early", updatedAt: startOf(31) + 1 },
      { id: "older", updatedAt: startOf(2) },
    ];
    expect(groupByRecency(items, (item) => item.updatedAt, now)).toEqual([
      { id: "today", items: [items[1], items[2]] },
      { id: "earlier", items: [items[0], items[3]] },
    ]);
  });
});
