import { describe, expect, it } from "vitest";
import { buildSearchQuery } from "../../../functions/_shared/web-search";

describe("buildSearchQuery", () => {
  it("uses the latest user message and strips noise words into keywords", () => {
    const query = buildSearchQuery([
      { role: "user", text: "早上好" },
      { role: "assistant", text: "彩叶~早上好！" },
      { role: "user", text: "今天上海天气怎么样" },
    ]);

    expect(query).toBe("上海天气");
  });

  it("collapses newlines and tabs, strips noise, and merges CJK spacing", () => {
    const query = buildSearchQuery([{ role: "user", text: "  今天\n上海\t天气\r\n如何  " }]);

    expect(query).toBe("上海天气");
  });

  it("normalizes natural-language questions into search keywords", () => {
    const year = new Date().getUTCFullYear();
    expect(buildSearchQuery([{ role: "user", text: "今天上海的天气怎么样？" }])).toBe("上海天气");
    // "最近/最新"表达求新意图：查询词追加当前年份提升必应新鲜度排序
    expect(buildSearchQuery([{ role: "user", text: "最近有什么科技新闻？" }])).toBe(`科技新闻 ${year}`);
    expect(buildSearchQuery([{ role: "user", text: "東京の天気は？" }])).toBe("東京の天気");
  });

  it("appends the current year only for freshness-seeking questions", () => {
    const year = new Date().getUTCFullYear();
    expect(buildSearchQuery([{ role: "user", text: "Gemini最新模型是什么" }])).toBe(`Gemini模型 ${year}`);
    // "今天/现在"是实时语境（天气等必应本就返回当前信息），不追加年份
    expect(buildSearchQuery([{ role: "user", text: "现在几点了" }])).toBe("几点了");
    expect(buildSearchQuery([{ role: "user", text: "今天上海天气怎么样" }])).toBe("上海天气");
  });

  it("appends the previous question as context for corrections", () => {
    const query = buildSearchQuery([
      { role: "user", text: "Gemini最新模型是什么" },
      { role: "assistant", text: "Gemini最新的模型是3.1。" },
      { role: "user", text: "不对，Gemini 3.7 flash已经出来了" },
    ]);

    expect(query).toBe("Gemini 3.7 flash出来了 Gemini模型");
  });

  it("appends the previous question as context for short follow-ups", () => {
    const query = buildSearchQuery([
      { role: "user", text: "上海天气怎么样" },
      { role: "assistant", text: "上海今天多云。" },
      { role: "user", text: "那北京呢" },
    ]);

    expect(query).toBe("那北京 上海天气");
  });

  it("skips greetings and injected instructions as search context", () => {
    const greeted = buildSearchQuery([
      { role: "user", text: "你好" },
      { role: "assistant", text: "彩叶~你好！" },
      { role: "user", text: "上海天气怎么样" },
    ]);
    expect(greeted).toBe("上海天气");

    const injected = buildSearchQuery([
      { role: "user", text: "【前情提要 / 历史背景记忆】\n之前聊过旅行计划。" },
      { role: "assistant", text: "（已记住我们之前的对话与经历，继续交流~）" },
      { role: "user", text: "上海天气怎么样" },
    ]);
    expect(injected).toBe("上海天气");
  });

  it("does not duplicate identical context keywords", () => {
    const query = buildSearchQuery([
      { role: "user", text: "上海天气" },
      { role: "assistant", text: "上海今天多云。" },
      { role: "user", text: "上海天气" },
    ]);

    expect(query).toBe("上海天气");
  });

  it("falls back to the raw text when noise stripping empties the query", () => {
    expect(buildSearchQuery([{ role: "user", text: "怎么样？" }])).toBe("怎么样？");
  });

  it("truncates to 100 Unicode characters without splitting surrogate pairs", () => {
    expect(buildSearchQuery([{ role: "user", text: "月".repeat(150) }])).toBe("月".repeat(100));
    expect(buildSearchQuery([{ role: "user", text: "🌈".repeat(120) }])).toBe("🌈".repeat(100));
  });

  it("returns null for empty or whitespace-only text (image-only message)", () => {
    expect(buildSearchQuery([{ role: "user", text: "" }])).toBeNull();
    expect(buildSearchQuery([{ role: "user", text: " \n\t " }])).toBeNull();
  });

  it("returns null when no user message exists", () => {
    expect(buildSearchQuery([{ role: "assistant", text: "彩叶~" }])).toBeNull();
    expect(buildSearchQuery([])).toBeNull();
  });
});
