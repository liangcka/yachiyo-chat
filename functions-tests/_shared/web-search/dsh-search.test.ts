import { describe, expect, it, vi } from "vitest";
import { searchWeb } from "../../../functions/_shared/web-search";
import { BingWebSearchProvider } from "../../../functions/_shared/web-search/providers/bing";
import { BochaWebSearchProvider } from "../../../functions/_shared/web-search/providers/bocha";
import { BraveWebSearchProvider } from "../../../functions/_shared/web-search/providers/brave";
import { DeepSeekWebSearchProvider } from "../../../functions/_shared/web-search/providers/deepseek";
import { DuckDuckGoWebSearchProvider } from "../../../functions/_shared/web-search/providers/duckduckgo";
import { ExaWebSearchProvider } from "../../../functions/_shared/web-search/providers/exa";
import { GoogleWebSearchProvider } from "../../../functions/_shared/web-search/providers/google";
import { JinaWebSearchProvider } from "../../../functions/_shared/web-search/providers/jina";
import { PerplexityWebSearchProvider } from "../../../functions/_shared/web-search/providers/perplexity";
import { WebSearchProviderRegistry } from "../../../functions/_shared/web-search/providers/registry";
import { sieveSearchResult, sieveSearchResults } from "../../../functions/_shared/web-search/providers/search-sieve";
import { SearXNGWebSearchProvider } from "../../../functions/_shared/web-search/providers/searxng";
import { TavilyWebSearchProvider } from "../../../functions/_shared/web-search/providers/tavily";

describe("SearchSieve (Evidence Filter)", () => {
  it("rejects spam domains, game ad sites, and login portals", () => {
    expect(
      sieveSearchResult(
        { title: "Các Game Hài hước", url: "https://y8.com/games", snippet: "Chơi ngay" },
        "民主暗潮",
        "zh-CN",
      ),
    ).toBe(false);

    expect(
      sieveSearchResult(
        { title: "丰钧环保企业垃圾清运", url: "https://fengjun.trunsweb.com.tw/", snippet: "台中垃圾清运" },
        "民主暗潮",
        "zh-CN",
      ),
    ).toBe(false);

    expect(
      sieveSearchResult(
        { title: "登录自考系统", url: "https://zikao.com.cn/login", snippet: "请登录" },
        "民主暗潮",
        "zh-CN",
      ),
    ).toBe(false);

    expect(
      sieveSearchResult(
        { title: "Правила сообщества YouTube", url: "https://support.google.com/youtube/answer/9288567", snippet: "Russian text" },
        "民主暗潮",
        "zh-CN",
      ),
    ).toBe(false);

    expect(
      sieveSearchResult(
        { title: "Windows8 メールアプリのアカウント追加について", url: "https://answers.microsoft.com/ja-jp/windows/forum/all/...", snippet: "メール" },
        "民主暗潮",
        "zh-CN",
      ),
    ).toBe(false);

    expect(
      sieveSearchResult(
        { title: "Tires in Redmond, WA", url: "https://www.discounttire.com/redmond", snippet: "Tires" },
        "民主暗潮",
        "zh-CN",
      ),
    ).toBe(false);
  });

  it("accepts valid Chinese knowledge and gaming articles", () => {
    expect(
      sieveSearchResult(
        {
          title: "【绝地潜兵2】为什么被称为“民主暗潮”？",
          url: "https://www.gamersky.com/news/1.html",
          snippet: "因为其4人合作清怪玩法与暗潮相似，且管理式民主口号非常魔性。",
        },
        "民主暗潮",
        "zh-CN",
      ),
    ).toBe(true);

    expect(
      sieveSearchResult(
        {
          title: "Steam 社区 :: 指南 :: 为什么绝地潜兵2被称为“民主版暗潮”",
          url: "https://steamcommunity.com/sharedfiles/filedetails/?id=123456",
          snippet: "很多战锤40K暗潮玩家转战绝地潜兵2后戏称为民主暗潮。",
        },
        "Steam 民主版暗潮",
        "zh-CN",
      ),
    ).toBe(true);

    expect(
      sieveSearchResult(
        {
          title: "被玩家戏称为“民主版暗潮”的PVE射击游戏到底有多上头？",
          url: "https://nga.178.com/read.php?tid=99999",
          snippet: "绝地潜兵2作为今年现象级第三人称射击游戏，打虫子和暗潮体验很像。",
        },
        "民主版暗潮 射击游戏",
        "zh-CN",
      ),
    ).toBe(true);
  });

  it("rejects completely irrelevant video editing and software download ads", () => {
    expect(
      sieveSearchResult(
        {
          title: "CapCut AI Video Editor: Smart Online Video Editing with Advanced AI Tools",
          url: "https://www.capcut.com/tools/ai-video-editor",
          snippet: "Experience cutting-edge video editing with CapCut.",
        },
        "绝地潜兵反是民主版40K吗",
        "zh-CN",
      ),
    ).toBe(false);

    expect(
      sieveSearchResult(
        {
          title: "网友调侃 Gemini 为韭菜大豆包，你就当看个乐",
          url: "https://www.zhihu.com/question/12345",
          snippet: "为什么会被说成草包？你如何看待这轮背刺？",
        },
        "绝地潜兵反是民主版40K吗",
        "zh-CN",
      ),
    ).toBe(false);
  });

  it("rejects political party and election noise when query is not political", () => {
    expect(
      sieveSearchResult(
        {
          title: "风平浪静下暗潮涌动，美国民主党权力交接完成",
          url: "https://news.example.com/1",
          snippet: "选出首位黑人领袖佩洛西与众议院民主党内斗",
        },
        "民主版暗潮是什么",
        "zh-CN",
      ),
    ).toBe(false);

    expect(
      sieveSearchResult(
        {
          title: "奥巴马政治计算失灵 民主党内斗暗潮汹涌",
          url: "https://news.example.com/2",
          snippet: "民主党内部危机与选情暗潮",
        },
        "民主暗潮",
        "intl",
      ),
    ).toBe(false);
  });

  it("filters batch results using sieveSearchResults", () => {
    const list = [
      { title: "垃圾广告", url: "https://cellphones.com.vn/sforum/top", snippet: "tiếng Việt" },
      {
        title: "CapCut Video Editor",
        url: "https://www.capcut.com/",
        snippet: "Video tools",
      },
      { title: "有效百科", url: "https://zh.wikipedia.org/wiki/Helldivers_2", snippet: "绝地潜兵2介绍" },
    ];
    const filtered = sieveSearchResults(list, "绝地潜兵", "zh-CN");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("有效百科");
  });
});

describe("DeepSeekWebSearchProvider", () => {
  const provider = new DeepSeekWebSearchProvider();

  it("checks availability based on DEEPSEEK_API_KEY", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ DEEPSEEK_API_KEY: "sk-deepseek-123" })).toBe(true);
  });

  it("executes DeepSeek web search and returns formatted structured results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    title: "DeepSeek Harness 架构文档",
                    url: "https://github.com/deepseek-ai/deepseek-harness",
                    snippet: "DeepSeek Harness 是模块化 Agent 运行时框架",
                    publishedAt: "2026-08-20",
                  },
                ]),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "DeepSeek Harness" },
      undefined,
      { DEEPSEEK_API_KEY: "sk-test" },
    );

    expect(results).toEqual([
      {
        title: "DeepSeek Harness 架构文档",
        url: "https://github.com/deepseek-ai/deepseek-harness",
        snippet: "DeepSeek Harness 是模块化 Agent 运行时框架",
        publishedAt: "2026-08-20",
      },
    ]);
  });
});

describe("PerplexityWebSearchProvider", () => {
  const provider = new PerplexityWebSearchProvider();

  it("checks availability based on PERPLEXITY_API_KEY", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ PERPLEXITY_API_KEY: "pplx-123" })).toBe(true);
  });

  it("executes Perplexity Sonar search and extracts citations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "DeepSeek-Harness 是 DeepSeek AI 发布的 Agent 架构工具包。",
              },
            },
          ],
          citations: ["https://example.com/deepseek-harness-news"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "DeepSeek Harness" },
      undefined,
      { PERPLEXITY_API_KEY: "pplx-test" },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe("https://example.com/deepseek-harness-news");
    expect(results[0]?.snippet).toContain("DeepSeek-Harness");
  });
});

describe("ExaWebSearchProvider", () => {
  const provider = new ExaWebSearchProvider();

  it("checks availability based on EXA_API_KEY", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ EXA_API_KEY: "exa-12345" })).toBe(true);
  });

  it("executes Exa neural search and returns formatted results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "绝地潜兵2 民主暗潮详析",
              url: "https://example.com/helldivers",
              highlights: ["绝地潜兵2被戏称为民主暗潮"],
              publishedDate: "2026-02-15T00:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "民主暗潮是什么" },
      undefined,
      { EXA_API_KEY: "exa-test-key" },
    );

    expect(results).toEqual([
      {
        title: "绝地潜兵2 民主暗潮详析",
        url: "https://example.com/helldivers",
        snippet: "绝地潜兵2被戏称为民主暗潮",
        publishedAt: "2026-02-15",
      },
    ]);
  });
});

describe("TavilyWebSearchProvider", () => {
  const provider = new TavilyWebSearchProvider();

  it("checks availability based on TAVILY_API_KEY", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ TAVILY_API_KEY: "tvly-12345" })).toBe(true);
  });

  it("executes Tavily research search and returns formatted results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "战锤40K暗潮与绝地潜兵对比",
              url: "https://example.com/darktide-vs-helldivers",
              content: "两款均为4人组队PVE射击游戏",
              published_date: "2026-03-01",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "民主暗潮" },
      undefined,
      { TAVILY_API_KEY: "tvly-test-key" },
    );

    expect(results).toEqual([
      {
        title: "战锤40K暗潮与绝地潜兵对比",
        url: "https://example.com/darktide-vs-helldivers",
        snippet: "两款均为4人组队PVE射击游戏",
        publishedAt: "2026-03-01",
      },
    ]);
  });
});

describe("JinaWebSearchProvider", () => {
  const provider = new JinaWebSearchProvider();

  it("checks availability based on JINA_API_KEY or DSH_WEB_SEARCH_PROVIDER", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ JINA_API_KEY: "jina-12345" })).toBe(true);
    expect(provider.available({ DSH_WEB_SEARCH_PROVIDER: "jina" })).toBe(true);
    expect(provider.available({ ENABLE_JINA: "true" })).toBe(true);
  });

  it("executes Jina AI search and returns formatted results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          status: 20000,
          data: [
            {
              title: "绝地潜兵2 为什么叫民主版暗潮",
              url: "https://example.com/helldivers-darktide",
              description: "《绝地潜兵2》被许多玩家戏称为“民主版40K”或“民主暗潮”。",
              publishedTime: "2026-03-10",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "民主版40k" },
      undefined,
      { JINA_API_KEY: "test-jina-key" },
    );

    expect(results).toEqual([
      {
        title: "绝地潜兵2 为什么叫民主版暗潮",
        url: "https://example.com/helldivers-darktide",
        snippet: "《绝地潜兵2》被许多玩家戏称为“民主版40K”或“民主暗潮”。",
        publishedAt: "2026-03-10",
      },
    ]);
  });
});

describe("BraveWebSearchProvider", () => {
  const provider = new BraveWebSearchProvider();

  it("checks availability based on BRAVE_API_KEY", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ BRAVE_API_KEY: "brave-12345" })).toBe(true);
  });

  it("executes Brave search and returns formatted results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "绝地潜兵2 武器配置指南",
                url: "https://example.com/helldivers2-weapons",
                description: "详细介绍绝地潜兵2各主流武器配装与实战技巧",
                page_age: "2026-03-01",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "绝地潜兵2 武器" },
      undefined,
      { BRAVE_API_KEY: "brave-key" },
    );

    expect(results).toEqual([
      {
        title: "绝地潜兵2 武器配置指南",
        url: "https://example.com/helldivers2-weapons",
        snippet: "详细介绍绝地潜兵2各主流武器配装与实战技巧",
        publishedAt: "2026-03-01",
      },
    ]);
  });
});

describe("SearXNGWebSearchProvider", () => {
  const provider = new SearXNGWebSearchProvider();

  it("checks availability based on SEARXNG_BASE_URL", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ SEARXNG_BASE_URL: "https://searx.example.org" })).toBe(true);
  });

  it("executes SearXNG search and returns formatted results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "开源模型对比评测",
              url: "https://example.com/llm-benchmark",
              content: "各大开源大模型的综合评测报告与基准测试数据",
              publishedDate: "2026-04-12",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "开源模型对比" },
      undefined,
      { SEARXNG_BASE_URL: "https://searx.example.org" },
    );

    expect(results).toEqual([
      {
        title: "开源模型对比评测",
        url: "https://example.com/llm-benchmark",
        snippet: "各大开源大模型的综合评测报告与基准测试数据",
        publishedAt: "2026-04-12",
      },
    ]);
  });
});

describe("BochaWebSearchProvider", () => {
  const provider = new BochaWebSearchProvider();

  it("checks availability based on BOCHA_API_KEY", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ BOCHA_API_KEY: "bocha-12345" })).toBe(true);
  });

  it("executes Bocha AI search and returns formatted results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            webPages: {
              value: [
                {
                  name: "博查搜索引擎",
                  url: "https://example.com/bocha-intro",
                  summary: "博查专为中文 AI 搜索与 Agent 架构打造",
                  datePublished: "2026-05-20",
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "博查 AI" },
      undefined,
      { BOCHA_API_KEY: "bocha-key" },
    );

    expect(results).toEqual([
      {
        title: "博查搜索引擎",
        url: "https://example.com/bocha-intro",
        snippet: "博查专为中文 AI 搜索与 Agent 架构打造",
        publishedAt: "2026-05-20",
      },
    ]);
  });
});

describe("GoogleWebSearchProvider", () => {
  const provider = new GoogleWebSearchProvider();

  it("checks availability based on GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX", () => {
    expect(provider.available({})).toBe(false);
    expect(provider.available({ GOOGLE_SEARCH_API_KEY: "key" })).toBe(false);
    expect(provider.available({ GOOGLE_SEARCH_API_KEY: "key", GOOGLE_SEARCH_CX: "cx" })).toBe(true);
  });

  it("executes Google Custom Search and parses results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              title: "Google Search 结果",
              link: "https://example.com/google-hit",
              snippet: "Google Custom Search 命中的摘要内容",
              pagemap: {
                metatags: [{ "article:published_time": "2026-06-01T08:00:00Z" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await provider.search(
      { query: "Google 测试" },
      undefined,
      { GOOGLE_SEARCH_API_KEY: "g-key", GOOGLE_SEARCH_CX: "g-cx" },
    );

    expect(results).toEqual([
      {
        title: "Google Search 结果",
        url: "https://example.com/google-hit",
        snippet: "Google Custom Search 命中的摘要内容",
        publishedAt: "2026-06-01",
      },
    ]);
  });
});

describe("WebSearchProviderRegistry", () => {
  it("resolves providers and prioritizes configured DSH_WEB_SEARCH_PROVIDER", () => {
    const registry = new WebSearchProviderRegistry();
    const defaultList = registry.resolveProviders({});
    expect(defaultList.length).toBeGreaterThan(5);

    const prioritized = registry.resolveProviders({ DSH_WEB_SEARCH_PROVIDER: "brave" });
    expect(prioritized[0]?.id).toBe("brave");
  });
});

describe("BingWebSearchProvider & DuckDuckGoWebSearchProvider", () => {
  it("providers check availability properly", () => {
    const bing = new BingWebSearchProvider();
    const ddg = new DuckDuckGoWebSearchProvider();
    expect(bing.available()).toBe(true);
    expect(bing.id).toBe("bing");
    expect(ddg.available({})).toBe(false);
    expect(ddg.available({ DSH_WEB_SEARCH_PROVIDER: "duckduckgo" })).toBe(true);
    expect(ddg.available({ ENABLE_DUCKDUCKGO: "true" })).toBe(true);
    expect(ddg.id).toBe("duckduckgo");
  });
});

describe("WebRuntime Router (searchWeb cascade)", () => {
  it("cascades to Jina when JINA_API_KEY is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          status: 20000,
          data: [
            {
              title: "Jina 边缘搜索命中",
              url: "https://example.com/jina-hit",
              description: "Jina AI 成功返回",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({
      query: "民主版40k",
      locale: "zh-CN",
      smart: false,
      env: { JINA_API_KEY: "jina-key" },
    });

    expect(results[0]?.title).toBe("Jina 边缘搜索命中");
  });
  it("cascades to DeepSeek when DEEPSEEK_API_KEY is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    title: "DeepSeek 检索命中",
                    url: "https://example.com/deepseek-hit",
                    snippet: "DeepSeek Web Search 成功返回",
                  },
                ]),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({
      query: "DeepSeek 测试",
      locale: "zh-CN",
      smart: false,
      env: { DEEPSEEK_API_KEY: "sk-ds" },
    });

    expect(results[0]?.title).toBe("DeepSeek 检索命中");
  });

  it("cascades to Exa when EXA_API_KEY is present and DeepSeek is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "民主暗潮 Exa 命中的结果",
              url: "https://example.com/exa-result",
              highlights: ["这是Exa检索到的民主暗潮精准结果"],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({
      query: "民主暗潮",
      locale: "zh-CN",
      smart: false,
      env: { EXA_API_KEY: "exa-key" },
    });

    expect(results[0]?.title).toBe("民主暗潮 Exa 命中的结果");
  });

  it("prioritizes provider configured via DSH_WEB_SEARCH_PROVIDER", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("perplexity")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Perplexity 答案" } }],
            citations: ["https://example.com/pplx-priority"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb({
      query: "优先路由测试",
      locale: "zh-CN",
      smart: false,
      env: {
        DSH_WEB_SEARCH_PROVIDER: "perplexity",
        PERPLEXITY_API_KEY: "pplx-key",
        EXA_API_KEY: "exa-key",
      },
    });

    expect(results[0]?.url).toBe("https://example.com/pplx-priority");
  });
});

