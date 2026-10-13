import { describe, expect, it } from "vitest";
import {
  isUntitledConversation,
  parseConversationMetadata,
} from "./conversation-metadata";

describe("parseConversationMetadata", () => {
  it("解析完整 JSON 并规范记忆空白，保留自由文本结构", () => {
    expect(parseConversationMetadata(JSON.stringify({
      title: "  夏夜的约定  ",
      memory: "  喜欢草莓大福  \r\n \r\n\r\n  周末准备旅行。  \n",
    }))).toEqual({ title: "夏夜的约定", memory: "喜欢草莓大福\n\n周末准备旅行。" });
  });

  it("接受完整代码围栏与 null，不接受围栏之外的说明", () => {
    expect(parseConversationMetadata('```json\n{"title":null,"memory":null}\n```')).toEqual({
      title: null,
      memory: null,
    });
    expect(parseConversationMetadata('```\n{"title":"旅行","memory":""}\n```')).toEqual({
      title: "旅行",
      memory: "",
    });
    expect(parseConversationMetadata('结果：\n```json\n{"title":null,"memory":null}\n```'))
      .toBeUndefined();
  });

  it.each([
    "",
    "null",
    "[]",
    '{"title":"标题"}',
    '{"memory":"画像"}',
    '{"title":"标题","memory":null,"extra":true}',
    '{"title":42,"memory":null}',
    '{"title":null,"memory":[]}',
    '{"title":"  ","memory":null}',
    '{"title":"第一行\\n第二行","memory":null}',
    JSON.stringify({ title: "一\u2028二", memory: null }),
    '{"title":null,"memory":null} 后续文本',
  ])("拒绝非法结构或标题：%s", (text) => {
    expect(parseConversationMetadata(text)).toBeUndefined();
  });

  it("按 Unicode 码点验证标题与记忆长度，不截断非法输出", () => {
    expect(parseConversationMetadata(JSON.stringify({ title: "🌸".repeat(24), memory: "🌙".repeat(2000) })))
      .toEqual({ title: "🌸".repeat(24), memory: "🌙".repeat(2000) });
    expect(parseConversationMetadata(JSON.stringify({ title: "🌸".repeat(25), memory: null })))
      .toBeUndefined();
    expect(parseConversationMetadata(JSON.stringify({ title: null, memory: "🌙".repeat(2001) })))
      .toBeUndefined();
  });
});

describe("isUntitledConversation", () => {
  it("仅把没有标题来源的默认中日标题视为未命名", () => {
    expect(isUntitledConversation({ title: "新的对话" })).toBe(true);
    expect(isUntitledConversation({ title: "新しい会話" })).toBe(true);
    expect(isUntitledConversation({ title: "我的旅行" })).toBe(false);
    expect(isUntitledConversation({ title: "新的对话", titleSource: "manual" })).toBe(false);
    expect(isUntitledConversation({ title: "新的对话", titleSource: "generated" })).toBe(false);
  });
});
