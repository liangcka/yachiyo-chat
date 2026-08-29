import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWeb } from "../../../functions/_shared/web-search";
import { sampleRss } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("searchWeb", () => {
  it("requests the Bing RSS endpoint with browser headers and parses results", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(sampleRss, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({ query: "上海天气" });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      `https://www.bing.com/search?q=${encodeURIComponent("上海天气")}&format=rss&mkt=zh-CN&setlang=zh-hans`,
    );
    const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.accept).toBe("application/rss+xml, application/xml, text/xml, */*");
    expect(headers["accept-language"]).toBe("zh-CN,zh;q=0.9");
    expect(headers["user-agent"]).toMatch(/^Mozilla\/5\.0/u);
    expect(results).toHaveLength(5);
    expect(results[0]?.title).toBe("上海今日天气 & 空气质量");
  });

  it("locks the Japanese market and language for ja-JP requests", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(sampleRss, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchWeb({ query: "東京の天気", locale: "ja-JP" });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      `https://www.bing.com/search?q=${encodeURIComponent("東京の天気")}&format=rss&mkt=ja-JP&setlang=ja`,
    );
    const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers["accept-language"]).toBe("ja-JP,ja;q=0.9");
  });

  it("returns an empty list for non-200 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 503 })),
    );

    await expect(searchWeb({ query: "test" })).resolves.toEqual([]);
  });

  it("returns an empty list when the body is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    await expect(searchWeb({ query: "test" })).resolves.toEqual([]);
  });

  it("returns an empty list when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(searchWeb({ query: "test" })).resolves.toEqual([]);
  });

  it("silently degrades after the 8-second internal timeout", async () => {
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

    const pending = searchWeb({ query: "slow query" });
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(pending).resolves.toEqual([]);
  });

  it("aborts the outbound fetch when the caller signal fires", async () => {
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
    const pending = searchWeb({ query: "test", locale: "zh-CN", signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual([]);
  });
});

describe("searchWeb (domain dedup)", () => {
  /** 生成同域名 n 条 + 其他域名 2 条的 RSS */
  function stackedRss(domain: string, count: number): string {
    const sameSite = Array.from({ length: count }, (_unused, index) => {
      return `<item><title>堆-${index}</title><link>https://${domain}/page-${index}</link><description>内容</description></item>`;
    });
    const others = [
      `<item><title>其他一</title><link>https://other-one.example.org/</link><description>内容</description></item>`,
      `<item><title>其他二</title><link>https://other-two.example.net/</link><description>内容</description></item>`,
    ];
    return `<rss version="2.0"><channel>${sameSite.join("")}${others.join("")}</channel></rss>`;
  }

  it("keeps at most two results per registrable domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
        async () => new Response(stackedRss("news.example.cn", 3), { status: 200 }),
      ),
    );

    const results = await searchWeb({ query: "测试" });

    expect(results.filter((result) => result.url.startsWith("https://news.example.cn/"))).toHaveLength(2);
    expect(results.map((result) => result.title)).toEqual(["堆-0", "堆-1", "其他一", "其他二"]);
  });

  it("treats multi-part public suffixes like co.jp as one registrable domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
        async () => new Response(stackedRss("blog.example.co.jp", 3), { status: 200 }),
      ),
    );

    const results = await searchWeb({ query: "测试" });

    expect(results.filter((result) => result.url.includes("example.co.jp"))).toHaveLength(2);
  });
});

describe("searchWeb (smart)", () => {
  /** 生成 n 条结果的 RSS：标题与 URL 均带前缀，便于区分两路来源；域名互不相同，避免触发同域名去重 */
  function rssWith(prefix: string, count: number): string {
    const items = Array.from({ length: count }, (_unused, index) => {
      const url = `https://${prefix}${index}.test/${index}`;
      return `<item><title>${prefix}-${index}</title><link>${url}</link><description>${prefix}</description><pubDate>Fri, 21 Aug 2026 06:19:00 GMT</pubDate></item>`;
    });
    return `<rss version="2.0"><channel>${items.join("")}</channel></rss>`;
  }

  it("issues parallel local and international requests and merges deduped results", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (input) =>
        new Response(
          input.includes("mkt=en-US") ? rssWith("intl", 5) : rssWith("local", 5),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({ query: "Gemini 最新模型", locale: "zh-CN", smart: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([input]) => input as string);
    expect(urls[0]).toBe(
      `https://www.bing.com/search?q=${encodeURIComponent("Gemini 最新模型")}&format=rss&mkt=zh-CN&setlang=zh-hans`,
    );
    expect(urls[1]).toBe(
      `https://www.bing.com/search?q=${encodeURIComponent("Gemini 最新模型")}&format=rss&mkt=en-US&setlang=en&qft=${encodeURIComponent('interval="30"')}`,
    );
    const intlHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)
      ?.headers as Record<string, string>;
    expect(intlHeaders["accept-language"]).toBe("en-US,en;q=0.9");

    // 本地路与国际路按 Round-Robin 轮询交错合并，共 10 条
    expect(results.map((result) => result.title)).toEqual([
      "local-0",
      "intl-0",
      "local-1",
      "intl-1",
      "local-2",
      "intl-2",
      "local-3",
      "intl-3",
      "local-4",
      "intl-4",
    ]);
    // 智能模式保留发布日期
    expect(results.every((result) => result.publishedAt === "2026-08-21")).toBe(true);
  });

  it("drops duplicate URLs across markets and caps merged results at ten", async () => {
    const shared = rssWith("shared", 5);
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(shared, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({ query: "test", locale: "zh-CN", smart: true });

    // 两路返回相同 URL，去重后仅剩 5 条
    expect(results).toHaveLength(5);
    expect(new Set(results.map((result) => result.url)).size).toBe(5);
  });

  it("still returns the local results when the international route fails", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (input.includes("mkt=en-US")) throw new Error("blocked");
        return new Response(rssWith("local", 3), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({ query: "test", locale: "zh-CN", smart: true });

    expect(results.map((result) => result.title)).toEqual(["local-0", "local-1", "local-2"]);
  });

  it("still returns the international results when the local route fails", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (input.includes("mkt=zh-CN")) return new Response("denied", { status: 503 });
        return new Response(rssWith("intl", 2), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({ query: "test", locale: "zh-CN", smart: true });

    expect(results.map((result) => result.title)).toEqual(["intl-0", "intl-1"]);
  });

  it("keeps the single-market behavior when smart is off", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(rssWith("local", 5), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({ query: "test", locale: "zh-CN", smart: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.title)).toEqual([
      "local-0",
      "local-1",
      "local-2",
      "local-3",
      "local-4",
    ]);
  });
});

describe("searchWeb (multi-query)", () => {
  function rssWith(prefix: string, count: number): string {
    const items = Array.from({ length: count }, (_unused, index) => {
      const url = `https://${prefix}${index}.test/${index}`;
      return `<item><title>${prefix}-${index}</title><link>${url}</link><description>${prefix}</description></item>`;
    });
    return `<rss version="2.0"><channel>${items.join("")}</channel></rss>`;
  }

  it("executes multiple queries concurrently and merges via round-robin", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (input.includes(encodeURIComponent("DeepSeek V4"))) {
          return new Response(rssWith("ds", 3), { status: 200 });
        }
        return new Response(rssWith("claude", 3), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({ query: ["DeepSeek V4", "Claude 3.7"], locale: "zh-CN", smart: false });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.title)).toEqual([
      "ds-0",
      "claude-0",
      "ds-1",
      "claude-1",
      "ds-2",
    ]);
  });

  it("deduplicates identical queries in the input array", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(rssWith("res", 3), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchWeb({ query: ["上海天气", "上海天气", "  上海天气  "] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when queries array is empty or only whitespace", async () => {
    await expect(searchWeb({ query: [] })).resolves.toEqual([]);
    await expect(searchWeb({ query: ["  ", ""] })).resolves.toEqual([]);
  });
});
