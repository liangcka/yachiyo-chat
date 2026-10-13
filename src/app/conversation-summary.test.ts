import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../domain/chat";
import {
  buildConversationSummaryBatch,
  parseConversationSummary,
  selectConversationSummaryMessages,
} from "./conversation-summary";

const limits = { messages: 20, messageCharacters: 4_000, totalCharacters: 24_000 };

function message(index: number, text = `消息 ${index}`): ChatMessage {
  return {
    id: `message-${index}`,
    conversationId: "conversation-1",
    createdAt: index,
    role: index % 2 === 0 ? "user" : "assistant",
    status: "complete",
    text,
  };
}

describe("会话摘要", () => {
  it("保留最新完整一轮和其后的待回复消息", () => {
    const history = Array.from({ length: 7 }, (_, index) => message(index));
    expect(selectConversationSummaryMessages(history).map(({ id }) => id)).toEqual([
      "message-0", "message-1", "message-2", "message-3",
    ]);
    expect(selectConversationSummaryMessages(history, 1).map(({ id }) => id)).toEqual([
      "message-2", "message-3",
    ]);
  });

  it("只有一轮对话时不压缩最近的原文", () => {
    expect(selectConversationSummaryMessages([message(0), message(1)])).toEqual([]);
  });

  it("压缩边界不会覆盖与保留轮次具有相同时间戳的消息", () => {
    const history = [message(0), { ...message(1), createdAt: 2 }, message(2), message(3)];
    const selected = selectConversationSummaryMessages(history);
    expect(selected.map(({ id }) => id)).toEqual(["message-0"]);
    expect(selected.at(-1)?.createdAt).toBeLessThan(history[2]!.createdAt);
  });

  it("输入乱序时从最早未压缩消息开始，并保留最新轮次", () => {
    const history = [message(5), message(2), message(1), message(4), message(3), message(0)];
    expect(selectConversationSummaryMessages(history, 1).map(({ id }) => id)).toEqual([
      "message-2", "message-3",
    ]);
    expect(history[0]?.id).toBe("message-5");
  });

  it("按 Unicode 字符拆分超长源消息且保留全部内容", () => {
    const longMessage = message(0, "🌕".repeat(5_001));
    const batch = buildConversationSummaryBatch([longMessage, message(1)], "zh-CN", undefined, limits);
    expect(batch?.included).toEqual([longMessage, message(1)]);
    expect(batch?.messages.slice(0, 2).map(({ text }) => text).join("")).toBe(longMessage.text);
    expect(batch?.messages.every(({ text }) => [...text].length <= 4_000)).toBe(true);
  });

  it("一批达到预算时停在连续前缀并把完整的超预算消息留在下一批", () => {
    const history = Array.from({ length: 10 }, (_, index) => message(index, `${index}`.repeat(4_000)));
    const batch = buildConversationSummaryBatch(history, "zh-CN", "已有记忆", limits);
    expect(batch?.included.map(({ id }) => id)).toEqual([
      "message-0", "message-1", "message-2", "message-3", "message-4",
    ]);
    expect(batch?.messages.reduce((count, item) => count + [...item.text].length, 0)).toBeLessThanOrEqual(24_000);
    const next = buildConversationSummaryBatch(history.slice(batch?.included.length), "zh-CN", "新增摘要", limits);
    expect(next?.included[0]?.id).toBe("message-5");
  });

  it("单条源消息超过整批预算时拒绝整理，不跳过该消息", () => {
    expect(buildConversationSummaryBatch([
      message(0, "界".repeat(24_000)), message(1),
    ], "zh-CN", undefined, limits)).toBeUndefined();
  });

  it("已有摘要超过单条预算时拒绝整理而不截断旧记忆", () => {
    expect(buildConversationSummaryBatch([
      message(0), message(1),
    ], "zh-CN", "旧".repeat(4_000), limits)).toBeUndefined();
  });

  it("仅有图片的消息保留图片存在的事实", () => {
    const imageMessage = { ...message(0, ""), imageId: "image-1" };
    const selected = selectConversationSummaryMessages([imageMessage, message(1), message(2), message(3)]);
    expect(selected).toContain(imageMessage);
    const batch = buildConversationSummaryBatch(selected, "zh-CN", undefined, limits);
    expect(batch?.messages[0]?.text).toContain("发送了一张图片");
  });

  it("兼容纯文本并以 Unicode 字符计算摘要上限", () => {
    expect(parseConversationSummary(" 已确认的约定 ", false)).toBe("已确认的约定");
    const summary = "🌕".repeat(2_000);
    expect(parseConversationSummary(`<conversation_memory>${summary}</conversation_memory>`, false)).toBe(summary);
    expect(parseConversationSummary(`${summary}🌕`, false)).toBeUndefined();
    expect(parseConversationSummary("<conversation_memory>完整标签但被上游截断</conversation_memory>", true)).toBeUndefined();
  });

  it.each([
    "<conversation_memory>摘要</conversation_memory><user_profile>画像</user_profile>",
    "<conversation_memory>摘要</conversation_memory><conversation_memory>另一份</conversation_memory>",
    "正文<conversation_memory>摘要</conversation_memory>",
    "<conversation_memory>残缺摘要",
    "<conversation_memory></conversation_memory>",
  ])("拒绝损坏或混入其他区块的输出：%s", (output) => {
    expect(parseConversationSummary(output, false)).toBeUndefined();
  });
});
