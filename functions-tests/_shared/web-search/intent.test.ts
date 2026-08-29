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

  it("skips pure time and calendar inquiries as current time is in system prompt", () => {
    expect(shouldSearchWeb([{ role: "user", text: "现在几点" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "现在几点了" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "今天几号" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "今天是星期几" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "现在几点了呀~" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "今何時？" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "今日は何曜日？" }])).toBe(false);
  });

  it("skips character interaction and daily emotional chit-chat", () => {
    expect(shouldSearchWeb([{ role: "user", text: "你是谁" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "你叫什么名字" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "在干嘛呢" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "今天好累" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "抱抱我" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "想你了" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "八千代早安呀" }])).toBe(false);
  });

  it("skips standard creative, coding, math, and translation tasks without fresh triggers", () => {
    expect(shouldSearchWeb([{ role: "user", text: "写一首关于夏天的诗" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "讲个笑话" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "唱首歌吧" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "用Python写一个冒泡排序" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "1+1等于几" }])).toBe(false);
    expect(shouldSearchWeb([{ role: "user", text: "翻译成英文：你好世界" }])).toBe(false);
  });

  it("searches factual, time-sensitive, and follow-up questions", () => {
    expect(shouldSearchWeb([{ role: "user", text: "今天上海天气怎么样" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "GPT-5 最新消息" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "東京の天気は？" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "帮我查一下杭州天气" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "DeepSeek V4 发布了吗" }])).toBe(true);
  });

  it("searches concept definitions, internet memes, and gaming terms", () => {
    expect(shouldSearchWeb([{ role: "user", text: "民主暗潮是什么" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "民主暗潮是什么梗" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "什么是管理式民主" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "管理式民主怎么回事" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "ヘルダイバー2とは" }])).toBe(true);
  });

  it("searches when chatty prefixes precede substantive content", () => {
    expect(shouldSearchWeb([{ role: "user", text: "好的，那GPT-5发布了吗" }])).toBe(true);
    expect(shouldSearchWeb([{ role: "user", text: "八千代，民主暗潮是什么呀" }])).toBe(true);
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

