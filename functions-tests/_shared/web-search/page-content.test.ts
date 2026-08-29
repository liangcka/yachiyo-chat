import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichWithPageContent } from "../../../functions/_shared/web-search/page-content";
import { extractPageText } from "../../../functions/_shared/web-search/page-text";
import type { WebSearchResult } from "../../../functions/_shared/web-search/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("extractPageText", () => {
  it("strips scripts, styles, boilerplate blocks, and tags while decoding entities", () => {
    const html = [
      "<!DOCTYPE html><html><head><title>上海天气</title>",
      "<style>.main { color: red; }</style>",
      "<script>var tracking = 1;</script></head><body>",
      "<nav><a>登录</a> <a>注册</a></nav>",
      "<header>站点菜单 logo</header>",
      "<p>今日多云，24至30度。</p>",
      "<div>明日&nbsp;晴，适合出行。</div>",
      "<!-- 页脚注释 -->",
      "<footer>© 2026 example</footer>",
      "</body></html>",
    ].join("");
    const text = extractPageText(html);

    expect(text).toContain("上海天气");
    expect(text).toContain("今日多云，24至30度。");
    expect(text).toContain("明日 晴，适合出行。");
    expect(text).not.toContain("color");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain("登录");
    expect(text).not.toContain("站点菜单");
    expect(text).not.toContain("2026 example");
  });

  it("converts block boundaries into newlines and compresses whitespace", () => {
    const text = extractPageText("<div>第一段</div><p>第二段<br/>换行</p>");
    expect(text).toBe("第一段\n第二段\n换行");
  });
});

describe("enrichWithPageContent", () => {
  const baseResults: WebSearchResult[] = [
    { title: "甲", url: "https://a.example.com/1", snippet: "短摘要" },
    { title: "乙", url: "https://b.example.org/2", snippet: "短摘要" },
    { title: "丙", url: "https://c.example.net/3", snippet: "短摘要" },
    { title: "丁", url: "https://d.example.com/4", snippet: "短摘要" },
  ];

  it("fetches only the top three pages and keeps the rest untouched", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (input.startsWith("https://b.example.org")) {
          return new Response("<html><body><p>这是完整的页面正文内容，比 RSS 摘要详细得多。</p></body></html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response("plain text", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await enrichWithPageContent(baseResults, "zh-CN");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      "https://a.example.com/1",
      "https://b.example.org/2",
      "https://c.example.net/3",
    ]);
    expect(results[0]?.content).toBeUndefined();
    expect(results[1]?.content).toBe("这是完整的页面正文内容，比 RSS 摘要详细得多。");
    expect(results[2]?.content).toBeUndefined();
    expect(results[3]).toEqual(baseResults[3]);
  });

  it("degrades to the snippet on non-HTML or failed responses", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (input.startsWith("https://a.example.com")) {
          return new Response("forbidden", { status: 403 });
        }
        if (input.startsWith("https://b.example.org")) {
          throw new Error("network down");
        }
        return new Response("json payload", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await enrichWithPageContent(baseResults.slice(0, 3), "zh-CN");

    expect(results).toEqual(baseResults.slice(0, 3));
  });

  it("keeps the snippet when the extracted text is not longer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response("<html><body><p>短</p></body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    const results = await enrichWithPageContent(baseResults.slice(0, 1), "zh-CN");

    expect(results[0]?.content).toBeUndefined();
    expect(results[0]?.snippet).toBe("短摘要");
  });

  it("truncates fetched content to the Unicode limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
        async () =>
          new Response(`<html><body><p>${"正".repeat(2_000)}</p></body></html>`, {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    const results = await enrichWithPageContent(baseResults.slice(0, 1), "zh-CN");

    expect([...(results[0]?.content ?? "")]).toHaveLength(1_500);
  });

  it("silently degrades after the 5-second page timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const pending = enrichWithPageContent(baseResults.slice(0, 1), "zh-CN");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual(baseResults.slice(0, 1));
  });

  it("aborts page fetches when the caller signal fires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const controller = new AbortController();
    const pending = enrichWithPageContent(baseResults.slice(0, 2), "zh-CN", controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual(baseResults.slice(0, 2));
  });
});
