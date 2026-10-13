import { describe, expect, it } from "vitest";
import { composeUserMemory, parseUserMemorySources, parseUserMemoryHistory, type UserMemoryRevision } from "./user-memory";

const revision: UserMemoryRevision = {
  id: "revision", createdAt: 100, before: "绿茶", after: "咖啡", source: "manual",
};

describe("parseUserMemoryHistory", () => {
  it("只接收有效数组，复制已知字段并保留提交顺序", () => {
    expect(parseUserMemoryHistory(null)).toEqual([]);
    expect(parseUserMemoryHistory({})).toEqual([]);
    expect(parseUserMemoryHistory([
      { ...revision, createdAt: 1, extra: "忽略" },
      { ...revision, id: "older", createdAt: 10, source: "message", conversationId: "chat", messageId: "message" },
    ])).toEqual([
      { ...revision, createdAt: 1 },
      { ...revision, id: "older", createdAt: 10, source: "message", conversationId: "chat", messageId: "message" },
    ]);
  });

  it.each([
    null, [], {}, { ...revision, id: "" }, { ...revision, createdAt: NaN },
    { ...revision, createdAt: -1 }, { ...revision, createdAt: 8.64e15 + 1 }, { ...revision, before: 3 },
    { ...revision, after: null }, { ...revision, source: "unknown" },
    { ...revision, conversationId: 1 }, { ...revision, messageId: "" },
  ])("过滤损坏的历史条目 %j", (value) => {
    expect(parseUserMemoryHistory([value, revision])).toEqual([revision]);
  });

  it("允许可表示为日期的最大时间戳", () => {
    const latestDate = { ...revision, createdAt: 8.64e15 };
    expect(parseUserMemoryHistory([latestDate])).toEqual([latestDate]);
  });

  it("排除重复 ID 并仅保留最近 30 项，兼容已有超长手动记忆", () => {
    const entries = Array.from({ length: 31 }, (_, index) => ({ ...revision, id: `${index}`, before: "旧".repeat(5000) }));
    const history = parseUserMemoryHistory([entries[0], ...entries]);
    expect(history).toHaveLength(30);
    expect(history.map(({ id }) => id)).toEqual(entries.slice(0, 30).map(({ id }) => id));
    expect(history[0]?.before).toHaveLength(5000);
  });
});

describe("记忆来源", () => {
  it("合并展示时去重，存储保留各自来源，独立记忆原文不变", () => {
    const sources = { independent: "住在东京", conversations: [
      { conversationId: "a", memory: "喜欢绿茶" }, { conversationId: "b", memory: "喜欢绿茶\n喜欢草莓" },
    ] };
    expect(parseUserMemorySources(sources)).toEqual(sources);
    expect(composeUserMemory(sources)).toBe("住在东京\n喜欢绿茶\n喜欢草莓");
    expect(composeUserMemory({ independent: "原文\n\n", conversations: [] })).toBe("原文\n\n");
  });

  it.each([null, [], {}, { independent: 1, conversations: [] },
    { independent: "", conversations: [{ conversationId: "a", memory: 1 }] },
    { independent: "", conversations: [{ conversationId: "", memory: "事实" }] },
    { independent: "", conversations: [{ conversationId: "a", memory: "字".repeat(2001) }] },
    { independent: "", conversations: [{ conversationId: "a", memory: "甲" }, { conversationId: "a", memory: "乙" }] },
  ])("拒绝损坏来源 %j", (value) => {
    expect(parseUserMemorySources(value)).toBeUndefined();
  });

  it("损坏的来源快照不能用于撤销", () => {
    expect(parseUserMemoryHistory([{ ...revision, memorySourcesBefore: { independent: "绿茶", conversations: [] } }])).toEqual([]);
  });
});
