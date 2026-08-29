import { afterEach, describe, expect, it, vi } from "vitest";
import { performWebSearchPipeline } from "../../../functions/_shared/web-search/pipeline";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import { sampleRss } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("performWebSearchPipeline", () => {
  it("returns undefined when webSearch is not true or mode is summary", async () => {
    const judge = vi.fn().mockResolvedValue(true);

    const nonSearchRequest: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "今日上海天气" }],
      webSearch: false,
    };
    expect(await performWebSearchPipeline(nonSearchRequest, { judge })).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();

    const summaryRequest: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "今日上海天气" }],
      webSearch: true,
      mode: "summary",
    };
    expect(await performWebSearchPipeline(summaryRequest, { judge })).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("proceeds with search when judge returns true even if rule gate does not match", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        if (typeof url === "string" && url.includes("bing.com")) {
          return new Response(sampleRss, { status: 200 });
        }
        return new Response("<html><body><p>抓取到的网页正文内容详情</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const judge = vi.fn().mockResolvedValue(true);
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "介绍一下量子纠缠" }],
      webSearch: true,
    };

    const results = await performWebSearchPipeline(request, { judge });
    expect(judge).toHaveBeenCalled();
    expect(results).toBeDefined();
    expect(results?.length).toBeGreaterThan(0);
  });

  it("returns undefined when judge returns false and rule gate is not triggered", async () => {
    const judge = vi.fn().mockResolvedValue(false);
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "你好呀，今天心情不错" }],
      webSearch: true,
    };

    const results = await performWebSearchPipeline(request, { judge });
    expect(judge).toHaveBeenCalled();
    expect(results).toBeUndefined();
  });

  it("falls back to rule gate when judge returns null or throws", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        if (typeof url === "string" && url.includes("bing.com")) {
          return new Response(sampleRss, { status: 200 });
        }
        return new Response("<html><body><p>上海天气正文</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const judgeNull = vi.fn().mockResolvedValue(null);
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "今天上海天气怎么样" }],
      webSearch: true,
    };

    const results = await performWebSearchPipeline(request, { judge: judgeNull });
    expect(judgeNull).toHaveBeenCalled();
    expect(results).toBeDefined();
    expect(results?.length).toBeGreaterThan(0);

    const judgeThrow = vi.fn().mockRejectedValue(new Error("network error"));
    const resultsAfterThrow = await performWebSearchPipeline(request, { judge: judgeThrow });
    expect(resultsAfterThrow).toBeDefined();
    expect(resultsAfterThrow?.length).toBeGreaterThan(0);
  });

  it("returns undefined when queries list is empty (e.g. image-only message)", async () => {
    const judge = vi.fn().mockResolvedValue(true);
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "", imageDataUrl: "data:image/png;base64,abc" }],
      webSearch: true,
    };

    const results = await performWebSearchPipeline(request, { judge });
    expect(results).toBeUndefined();
  });

  it("returns undefined when search returns empty results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("error", { status: 500 })),
    );

    const judge = vi.fn().mockResolvedValue(true);
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "测试搜索" }],
      webSearch: true,
    };

    const results = await performWebSearchPipeline(request, { judge });
    expect(results).toBeUndefined();
  });

  it("returns enriched results when search succeeds", async () => {
    const samplePageHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>上海天气实况页面</title></head>
        <body>
          <main>
            <h1>上海今日天气预报</h1>
            <p>今天白天晴到多云，最高气温28度，东南风3到4级。</p>
          </main>
        </body>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (url) => {
        if (typeof url === "string" && url.includes("bing.com")) {
          return new Response(sampleRss, { status: 200 });
        }
        return new Response(samplePageHtml, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }),
    );

    const judge = vi.fn().mockResolvedValue(true);
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "今天上海天气" }],
      webSearch: true,
    };

    const results = await performWebSearchPipeline(request, { judge });
    expect(results).toBeDefined();
    expect(results![0]?.title).toBe("上海今日天气 & 空气质量");
    expect(results![0]?.url).toBe("https://weather.example.cn/a?x=1&y=2");
    expect(results![0]?.content).toContain("最高气温28度");
  });
});
