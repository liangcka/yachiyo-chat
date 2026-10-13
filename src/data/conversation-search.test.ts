import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, Conversation } from "../domain/chat";
import { searchConversations } from "./conversation-search";
import { YachiyoDatabase } from "./db";

describe("本地对话全文搜索", () => {
  let db: YachiyoDatabase;

  beforeEach(() => {
    db = new YachiyoDatabase(`search-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  function conversation(id: string, title: string, updatedAt: number): Conversation {
    return { id, title, locale: "zh-CN", createdAt: 1, updatedAt };
  }

  function message(id: string, conversationId: string, text: string, createdAt: number): ChatMessage {
    return { id, conversationId, text, role: "user", status: "complete", createdAt };
  }

  it("搜索未加载的旧消息，每段对话仅返回一次并按最近活动排序", async () => {
    await db.conversations.bulkPut([
      conversation("old", "旅行", 10),
      conversation("new", "东京散步", 20),
      conversation("other", "晚饭", 30),
    ]);
    await db.messages.bulkPut([
      message("old-match", "old", "很久以前在东京看樱花", 1),
      ...Array.from({ length: 120 }, (_, index) => message(`later-${index}`, "old", "别的话题", index + 2)),
      message("first", "new", "东京有很多公园", 1),
      message("latest", "new", "今晚去东京散步", 2),
      message("orphan", "deleted", "东京", 100),
    ]);

    const results = await searchConversations(db, "  东京  ");

    expect(results.map(({ conversation: item }) => item.id)).toEqual(["new", "old"]);
    expect(results[0]?.message).toMatchObject({ id: "latest", text: "今晚去东京散步" });
    expect(results[1]?.message?.id).toBe("old-match");
  });

  it("大小写无关且把正则符号当普通文本", async () => {
    await db.conversations.bulkPut([
      conversation("title", "React [计划]", 10),
      conversation("body", "项目", 20),
      conversation("miss", "React aaa", 30),
    ]);
    await db.messages.put(message("body-match", "body", "今天学习 REACT [计划]", 1));

    expect((await searchConversations(db, "react [计划]")).map(({ conversation: item }) => item.id))
      .toEqual(["body", "title"]);
    expect((await searchConversations(db, ".*")).length).toBe(0);
  });

  it("空查询返回全部对话且不附正文，最新会话优先", async () => {
    await db.conversations.bulkPut([conversation("a", "早晨", 10), conversation("b", "夜晚", 20)]);
    await db.messages.put(message("hello", "a", "你好", 2));
    expect(await searchConversations(db, " \n ")).toEqual([
      { conversation: conversation("b", "夜晚", 20) },
      { conversation: conversation("a", "早晨", 10) },
    ]);
  });

  it("长正文只返回命中附近的可读片段", async () => {
    await db.conversations.put(conversation("a", "旅行", 10));
    await db.messages.put(message("long", "a", `${"旧事".repeat(200)}想去京都${"后来".repeat(200)}`, 1));
    const results = await searchConversations(db, "京都");
    expect(results[0]?.message?.text).toContain("京都");
    expect(results[0]?.message?.text).toMatch(/^….*…$/u);
    expect(results[0]?.message?.text.length).toBeLessThan(220);
  });

  it("长查询和表情符号也保留完整的命中文本", async () => {
    const query = "京都".repeat(90);
    await db.conversations.put(conversation("a", "旅行", 10));
    await db.messages.put(message("long", "a", `${"🌸".repeat(100)}${query}${"🌸".repeat(100)}`, 1));
    const result = (await searchConversations(db, query))[0]?.message?.text;
    expect(result).toContain(query);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });
});
