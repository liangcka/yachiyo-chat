import { describe, expect, it } from "vitest";
import { shouldSearchWeb } from "../../../functions/_shared/web-search";

describe("shouldSearchWeb", () => {
  it("skips pure greetings with optional tone suffixes", () => {
    expect(shouldSearchWeb([{ role: "user", text: "你好" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "你好呀～" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "hello!" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "おはよう" }])).toBe(false);
  });

  it("skips pure reply, thanks, farewell, and emotional messages", () => {
    expect(shouldSearchWeb([{ role: "user", text: "好的，明白了～" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "嗯嗯嗯" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "哈哈哈哈" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "谢谢啦" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "太好了！我知道了" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "晚安，拜拜" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "okok" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "なるほど、わかった" }])).toBe(false);
  });

  it("skips pure emoticons and punctuation-only messages", () => {
    expect(shouldSearchWeb([{ role: "user", text: "(≧▽≦)" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "!!!~" }])).toBe(false);
  });

  it("skips conversation flow-control phrases", () => {
    expect(shouldSearchWeb([{ role: "user", text: "继续" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "然后呢" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "再说一遍" }])).toBe(false);
  });

  it("skips empty text (image-only) and missing user messages", () => {
    expect(shouldSearchWeb([{ role: "user", text: "" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: " \n\t " }])).toBe(false);
    expect(shouldSearchWeb([{ role: "assistant", text: "彩叶~" }])).toBe(false);
    expect(shouldSearchWeb([])).toBe(false);
  });

  it("searches factual, time-sensitive, and follow-up questions", () => {
    expect(shouldSearchWeb([{ role: "user", text: "今天上海天气怎么样" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "GPT-5 最新消息" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "東京の天気は？" }])).toBe(true);
  });

  it("searches when chatty prefixes precede substantive content", () => {
    expect(shouldSearchWeb([{ role: "user", text: "好的，那GPT-5发布了吗" }])).toBe(true);
  });

  it("searches short follow-ups and corrections that reference prior topics", () => {
    expect(
      shouldSearchWeb([
        { role: "user", text: "上海天气怎么样" },
        { role: "assistant", text: "上海今天多云。" },
        { role: "user", text: "那北京呢" },
      ]),
    ).toBe(true);
    expect(
      shouldSearchWeb([
        { role: "user", text: "Gemini最新模型是什么" },
        { role: "assistant", text: "Gemini最新的模型是3.1。" },
        { role: "user", text: "不对，Gemini 3.7 flash已经出来了" },
      ]),
    ).toBe(true);
  });
});
