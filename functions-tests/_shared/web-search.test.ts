import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSearchQuery,
  enrichWithPageContent,
  extractPageText,
  parseBingRss,
  searchWeb,
  shouldSearchWeb,
  type WebSearchResult,
} from "../../functions/_shared/web-search";

/** 模拟必应 RSS 真实结构：含实体编码、非法协议、缺字段与超量条目（域名各不相同，模拟自然多样性） */
const sampleRss = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<rss version="2.0"><channel>',
  "<title>上海天气 - Bing</title>",
  "<link>https://www.bing.com/search?q=%E4%B8%8A%E6%B5%B7%E5%A4%A9%E6%B0%94</link>",
  "<description>bing</description>",
  "<item><title>上海今日天气 &amp; 空气质量</title><link>https://weather.example.cn/a?x=1&amp;y=2</link><description>今日多云 &lt;24 至 30 度&gt;</description></item>",
  "<item><title>Tomorrow&apos;s forecast &quot;good&quot;</title><link>https://news.example.org/tomorrow</link><description>It&#39;ll be &#x27;sunny&#x27; &amp; warm.</description></item>",
  "<item><title>Bad protocol</title><link>javascript:alert(1)</link><description>evil</description></item>",
  "<item><title>Unsupported scheme</title><link>ftp://files.example.com/x</link><description>file</description></item>",
  "<item><title>Missing description</title><link>https://example.com/no-desc</link></item>",
  "<item><title>第三条</title><link>https://third.example.com/</link><description>三</description></item>",
  "<item><title>第四条</title><link>https://fourth.example.net/</link><description>四</description></item>",
  "<item><title>第五条</title><link>https://fifth.example.info/</link><description>五</description></item>",
  "<item><title>第六条</title><link>https://sixth.example.com/</link><description>六</description></item>",
  "<item><title>第七条</title><link>https://seventh.example.com/</link><description>七</description></item>",
  "</channel></rss>",
].join("");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

describe("searchWeb", () => {
  it("requests the Bing RSS endpoint with browser headers and parses results", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(sampleRss, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb("上海天气");

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

    await searchWeb("東京の天気", "ja-JP");

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

    await expect(searchWeb("test")).resolves.toEqual([]);
  });

  it("returns an empty list when the body is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    await expect(searchWeb("test")).resolves.toEqual([]);
  });

  it("returns an empty list when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(searchWeb("test")).resolves.toEqual([]);
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

    const pending = searchWeb("slow query");
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
    const pending = searchWeb("test", "zh-CN", controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual([]);
  });
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

    const results = await searchWeb("测试");

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

    const results = await searchWeb("测试");

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

    const results = await searchWeb("Gemini 最新模型", "zh-CN", undefined, true);

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

    // 本地路 5 条在前，国际路 5 条在后，共 10 条
    expect(results.map((result) => result.title).slice(0, 5)).toEqual([
      "local-0",
      "local-1",
      "local-2",
      "local-3",
      "local-4",
    ]);
    expect(results.map((result) => result.title).slice(5)).toEqual([
      "intl-0",
      "intl-1",
      "intl-2",
      "intl-3",
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

    const results = await searchWeb("test", "zh-CN", undefined, true);

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

    const results = await searchWeb("test", "zh-CN", undefined, true);

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

    const results = await searchWeb("test", "zh-CN", undefined, true);

    expect(results.map((result) => result.title)).toEqual(["intl-0", "intl-1"]);
  });

  it("keeps the single-market behavior when smart is off", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(rssWith("local", 5), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb("test", "zh-CN", undefined, false);

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
