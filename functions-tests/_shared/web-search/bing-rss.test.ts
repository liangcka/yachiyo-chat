import { describe, expect, it } from "vitest";
import { parseBingRss } from "../../../functions/_shared/web-search";
import { sampleRss } from "./fixtures";

describe("parseBingRss", () => {
  it("decodes entities, drops invalid items, and keeps at most five results", () => {
    const results = parseBingRss(sampleRss);

    expect(results).toEqual([
      {
        title: "上海今日天气 & 空气质量",
        url: "https://weather.example.cn/a?x=1&y=2",
        snippet: "今日多云 <24 至 30 度>",
      },
      {
        title: "Tomorrow's forecast \"good\"",
        url: "https://news.example.org/tomorrow",
        snippet: "It'll be 'sunny' & warm.",
      },
      { title: "第三条", url: "https://third.example.com/", snippet: "三" },
      { title: "第四条", url: "https://fourth.example.net/", snippet: "四" },
      { title: "第五条", url: "https://fifth.example.info/", snippet: "五" },
    ]);
  });

  it("truncates title, snippet, and url to their Unicode limits", () => {
    const xml = [
      "<rss version=\"2.0\"><channel>",
      `<item><title>${"题".repeat(200)}</title><link>https://example.com/${"u".repeat(600)}</link><description>${"摘".repeat(400)}</description></item>`,
      "</channel></rss>",
    ].join("");

    const [result] = parseBingRss(xml);

    expect([...result?.title ?? []]).toHaveLength(120);
    expect([...result?.url ?? []]).toHaveLength(512);
    expect([...result?.snippet ?? []]).toHaveLength(300);
  });

  it("returns an empty list for non-RSS or empty XML", () => {
    expect(parseBingRss("<html><body>blocked</body></html>")).toEqual([]);
    expect(parseBingRss("")).toEqual([]);
  });

  it("extracts pubDate as YYYY-MM-DD for English and Chinese formats", () => {
    const xml = [
      "<rss version=\"2.0\"><channel>",
      "<item><title>English date</title><link>https://example.com/en</link><description>d</description><pubDate>Fri, 21 Aug 2026 06:19:00 GMT</pubDate></item>",
      "<item><title>Chinese date</title><link>https://example.com/zh</link><description>d</description><pubDate>周五, 21 8月 2026 08:42:00 GMT</pubDate></item>",
      "<item><title>Invalid date</title><link>https://example.com/bad</link><description>d</description><pubDate>not a date</pubDate></item>",
      "<item><title>No date</title><link>https://example.com/none</link><description>d</description></item>",
      "</channel></rss>",
    ].join("");

    const results = parseBingRss(xml);

    expect(results.map((result) => result.publishedAt ?? null)).toEqual([
      "2026-08-21",
      "2026-08-21",
      null,
      null,
    ]);
  });
});
