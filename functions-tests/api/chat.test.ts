import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie, signSession } from "../../functions/_shared/session";
import { collectClientEvents } from "../../functions/_shared/stream";
import { onRequestPost } from "../../functions/api/chat";

const origin = "https://yachiyo.test";
const providerOrigin = "https://api.stepfun.com";
const providerPath = "/step_plan/v1/chat/completions";
const providerUrl = `${providerOrigin}${providerPath}`;
const providerFetch = vi.fn<typeof fetch>();

function providerSse(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

const bingUrlPrefix = "https://www.bing.com/search";

function bingRss(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"><channel><title>上海天气 - Bing</title>',
    "<item><title>上海天气实况</title><link>https://weather.example.cn/shanghai</link><description>今日多云，24至30度。</description></item>",
    "</channel></rss>",
  ].join("");
}

/** 国际路（en-US 近 30 天）的模拟结果：带发布日期的权威新信息 */
function internationalBingRss(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"><channel><title>Gemini - Bing</title>',
    "<item><title>Gemini 3.7 Flash</title><link>https://deepmind.google/models/gemini/flash/</link><description>Our most intelligent workhorse model.</description><pubDate>Thu, 20 Aug 2026 12:11:00 GMT</pubDate></item>",
    "</channel></rss>",
  ].join("");
}

function bingSearchUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&mkt=zh-CN&setlang=zh-hans`;
}

async function toRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Request> {
  return input instanceof Request ? input : new Request(input, init);
}

async function chatRequest(
  body: unknown,
  sessionId: string,
  runtimeEnv: Env = env,
  deviceId = "device-abc123",
): Promise<Request> {
  const token = await signSession(
    { sid: sessionId, exp: Date.now() + 60_000, deviceId },
    runtimeEnv.SESSION_SIGNING_SECRET,
  );
  const cookie = sessionCookie(token).split(";", 1)[0];

  return new Request(`${origin}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin,
    },
    body: JSON.stringify(body),
  });
}

async function invoke(request: Request, runtimeEnv: Env = env): Promise<Response> {
  return onRequestPost({ request, env: runtimeEnv });
}

beforeEach(async () => {
  const keys = await env.RATE_LIMIT_KV.list();
  await Promise.all(keys.keys.map(({ name }) => env.RATE_LIMIT_KV.delete(name)));
  providerFetch.mockReset();
  providerFetch.mockRejectedValue(new Error("Unexpected outbound request"));
  vi.stubGlobal("fetch", providerFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/chat", () => {
  it("requires a valid signed device session", async () => {
    const response = await invoke(
      new Request(`${origin}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ locale: "zh-CN", messages: [{ role: "user", text: "你好" }] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "SESSION_REQUIRED" } });
  });

  it("sends text with low effort and exposes only sanitized SSE", async () => {
    let outbound: Record<string, unknown> | undefined;
    let upstreamRequest: Request | undefined;
    providerFetch.mockImplementationOnce(async (input, init) => {
      upstreamRequest = input instanceof Request ? input : new Request(input, init);
      outbound = JSON.parse(await upstreamRequest.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~今天也辛苦啦！"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "今天有点累" }] },
        "text-session",
      ),
    );
    const clientText = await response.text();
    const events = await collectClientEvents(new Response(clientText).body!);

    expect(response.status).toBe(200);
    expect(upstreamRequest?.url).toBe(providerUrl);
    expect(upstreamRequest?.method).toBe("POST");
    expect(upstreamRequest?.headers.get("authorization")).toBe(
      `Bearer ${env.STEPFUN_API_KEY}`,
    );
    expect(outbound).toMatchObject({
      model: "step-3.7-flash",
      reasoning_effort: "low",
      stream: true,
    });
    expect(JSON.stringify(outbound)).toContain("月见八千代");
    expect(events).toEqual([
      { type: "delta", text: "彩叶~今天也辛苦啦！" },
      { type: "done", truncated: false },
    ]);
    expect(clientText).not.toContain(env.STEPFUN_API_KEY);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("sends the last user image with medium effort", async () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    let outbound: Record<string, unknown> | undefined;
    providerFetch.mockImplementationOnce(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.url).toBe(providerUrl);
      outbound = JSON.parse(await request.text()) as Record<string, unknown>;
      return new Response(providerSse("看见啦~"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "这是什么？", imageDataUrl }],
        },
        "image-session",
      ),
    );
    await response.text();

    expect(outbound).toMatchObject({ reasoning_effort: "medium" });
    expect(JSON.stringify(outbound)).toContain(imageDataUrl);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("never returns an upstream error body or provider credential", async () => {
    providerFetch.mockImplementationOnce(async (input) => {
      expect(String(input)).toBe(providerUrl);
      return new Response(`provider-debug ${env.STEPFUN_API_KEY}`, { status: 500 });
    });

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "你好" }] },
        "error-session",
      ),
    );
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toEqual({ error: { code: "PROVIDER_ERROR" } });
    expect(text).not.toContain("provider-debug");
    expect(text).not.toContain(env.STEPFUN_API_KEY);
  });

  it("rejects a consumed daily quota before contacting StepFun", async () => {
    const deviceId = "device-abc123";
    const date = new Date().toISOString().slice(0, 10);
    await env.RATE_LIMIT_KV.put(`quota:${date}:${deviceId}`, env.DAILY_REQUEST_LIMIT);

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "再聊一句" }] },
        "quota-session",
        env,
        deviceId,
      ),
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "DAILY_QUOTA_EXCEEDED" } });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("uses the same localized SSE contract in explicit mock mode", async () => {
    const mockEnv: Env = { ...env, APP_MODE: "mock" };
    const response = await invoke(
      await chatRequest(
        { locale: "ja-JP", messages: [{ role: "user", text: "こんばんは" }] },
        "mock-session",
        mockEnv,
      ),
      mockEnv,
    );
    const events = await collectClientEvents(response.body!);

    expect(response.status).toBe(200);
    expect(events.some((event) => event.type === "delta" && event.text.includes("彩葉"))).toBe(
      true,
    );
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("uses an explicit Step Plan key instead of the canned mock response", async () => {
    const mockEnv: Env = { ...env, APP_MODE: "mock" };
    const apiKey = "sk-step-plan-abcdefghijklmnopqrstuvwxyz012345";
    let upstreamRequest: Request | undefined;
    providerFetch.mockImplementationOnce(async (input, init) => {
      upstreamRequest = input instanceof Request ? input : new Request(input, init);
      return new Response(providerSse("这是 Step Plan 的真实流式回答"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "这次不要固定回复" }],
          provider: "stepfun",
          apiKey,
          model: "step-3.7-flash",
        },
        "mock-step-plan-session",
        mockEnv,
      ),
      mockEnv,
    );
    const events = await collectClientEvents(response.body!);

    expect(upstreamRequest?.url).toBe(providerUrl);
    expect(upstreamRequest?.headers.get("authorization")).toBe(`Bearer ${apiKey}`);
    expect(events).toEqual([
      { type: "delta", text: "这是 Step Plan 的真实流式回答" },
      { type: "done", truncated: false },
    ]);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("keeps the provider deadline active after streaming headers arrive", async () => {
    vi.useFakeTimers();
    let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    let providerSignal: AbortSignal | null = null;
    providerFetch.mockImplementationOnce(async (input, init) => {
      const providerRequest = input instanceof Request ? input : new Request(input, init);
      providerSignal = providerRequest.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            upstreamController = controller;
          },
          cancel,
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });

    const response = await invoke(
      await chatRequest(
        { locale: "zh-CN", messages: [{ role: "user", text: "hello" }] },
        "stream-timeout-session",
      ),
    );
    const eventsPromise = collectClientEvents(response.body!);

    await vi.advanceTimersByTimeAsync(30_000);
    const timedOut = providerSignal!.aborted === true;
    if (!timedOut) {
      upstreamController.close();
    }
    const events = await eventsPromise;
    vi.useRealTimers();

    expect(timedOut).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: "error", code: "PROVIDER_STREAM_ERROR" }]);
  });

  it("searches Bing first and streams sources before deltas when webSearch is on", async () => {
    const fetchUrls: string[] = [];
    let providerBody: Record<string, unknown> | undefined;
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      providerBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~查到啦 [1]"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气怎么样" }],
          webSearch: true,
        },
        "web-search-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    expect(fetchUrls).toEqual([bingSearchUrl("上海天气"), providerUrl]);
    expect(JSON.stringify(providerBody)).toContain("<web_search_results>");
    expect(JSON.stringify(providerBody)).toContain("上海天气实况");
    expect(events[0]).toEqual({
      type: "sources",
      sources: [{ title: "上海天气实况", url: "https://weather.example.cn/shanghai" }],
    });
    expect(events[1]).toEqual({ type: "delta", text: "彩叶~查到啦 [1]" });
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("runs dual-market search and injects dated sources when smartSearch is on", async () => {
    const fetchUrls: string[] = [];
    let providerBody: Record<string, unknown> | undefined;
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (request.url.startsWith(bingUrlPrefix)) {
        if (request.url.includes("mkt=en-US")) {
          return new Response(internationalBingRss(), {
            status: 200,
            headers: { "content-type": "text/xml" },
          });
        }
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      providerBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~最新的是3.7 flash哦 [2]"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "Gemini最新模型是什么" }],
          webSearch: true,
          smartSearch: true,
        },
        "smart-search-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    // 双路必应请求：本地市场 + en-US 近 30 天过滤
    expect(fetchUrls).toEqual([
      bingSearchUrl("Gemini模型"),
      `https://www.bing.com/search?q=${encodeURIComponent("Gemini模型")}&format=rss&mkt=en-US&setlang=en&qft=${encodeURIComponent('interval="30"')}`,
      providerUrl,
    ]);

    // prompt 注入两路合并结果，且智能模式带发布日期
    const systemContent = JSON.stringify(providerBody);
    expect(systemContent).toContain("上海天气实况");
    expect(systemContent).toContain("Gemini 3.7 Flash");
    expect(systemContent).toContain("发布于2026-08-20");
    expect(systemContent).toContain("优先采信发布日期更新");

    // sources 事件：本地路在前、国际路在后
    expect(events[0]).toEqual({
      type: "sources",
      sources: [
        { title: "上海天气实况", url: "https://weather.example.cn/shanghai" },
        { title: "Gemini 3.7 Flash", url: "https://deepmind.google/models/gemini/flash/" },
      ],
    });
    expect(events[1]).toEqual({ type: "delta", text: "彩叶~最新的是3.7 flash哦 [2]" });
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("continues the conversation without sources when Bing fails", async () => {
    const fetchUrls: string[] = [];
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response("denied", { status: 503 });
      }
      return new Response(providerSse("彩叶~我们聊聊别的吧"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气怎么样" }],
          webSearch: true,
        },
        "bing-fail-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    expect(fetchUrls).toEqual([bingSearchUrl("上海天气"), providerUrl]);
    expect(events.some((event) => event.type === "sources")).toBe(false);
    expect(events).toEqual([
      { type: "delta", text: "彩叶~我们聊聊别的吧" },
      { type: "done", truncated: false },
    ]);
  });

  it("skips the search step for summary mode and image-only messages", async () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const fetchUrls: string[] = [];
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      return new Response(providerSse("好的"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const summaryResponse = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [
            { role: "user", text: "你好" },
            { role: "assistant", text: "彩叶~" },
            { role: "user", text: "继续" },
          ],
          mode: "summary",
          webSearch: true,
        },
        "summary-skip-session",
      ),
    );
    const summaryEvents = await collectClientEvents(summaryResponse.body!);
    expect(summaryEvents.some((event) => event.type === "sources")).toBe(false);

    const imageResponse = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "", imageDataUrl }],
          webSearch: true,
        },
        "image-skip-session",
      ),
    );
    const imageEvents = await collectClientEvents(imageResponse.body!);

    expect(imageEvents.some((event) => event.type === "sources")).toBe(false);
    expect(fetchUrls).toEqual([providerUrl, providerUrl]);
  });

  it("relaxes the streaming cap to 1000 Unicode characters while online", async () => {
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      return new Response(providerSse("八".repeat(1_200)), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "讲个长故事" }],
          webSearch: true,
        },
        "online-cap-session",
      ),
    );
    const events = await collectClientEvents(response.body!);
    const text = events
      .filter((event) => event.type === "delta")
      .map((event) => (event.type === "delta" ? event.text : ""))
      .join("");

    expect([...text]).toHaveLength(1000);
    expect(events.at(-1)).toEqual({ type: "done", truncated: true });
  });

  it("injects search results into a user-key provider request as well", async () => {
    const openaiUrl = "https://api.openai.com/v1/chat/completions";
    const fetchUrls: string[] = [];
    let openaiBody: Record<string, unknown> | undefined;
    providerFetch.mockImplementation(async (input, init) => {
      const request = await toRequest(input, init);
      fetchUrls.push(request.url);
      if (request.url.startsWith(bingUrlPrefix)) {
        return new Response(bingRss(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      openaiBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      return new Response(providerSse("彩叶~帮你查过啦"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "今天上海天气" }],
          provider: "openai",
          apiKey: "sk-" + "a".repeat(40),
          model: "gpt-5.6-luna",
          webSearch: true,
        },
        "user-key-search-session",
      ),
    );
    const events = await collectClientEvents(response.body!);

    expect(fetchUrls).toEqual([bingSearchUrl("上海天气"), openaiUrl]);
    expect(JSON.stringify(openaiBody)).toContain("<web_search_results>");
    expect(events[0]?.type).toBe("sources");
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  });

  it("prepends two fixed mock sources in mock mode with webSearch", async () => {
    const mockEnv: Env = { ...env, APP_MODE: "mock" };
    const response = await invoke(
      await chatRequest(
        {
          locale: "zh-CN",
          messages: [{ role: "user", text: "你好" }],
          webSearch: true,
        },
        "mock-sources-session",
        mockEnv,
      ),
      mockEnv,
    );
    const events = await collectClientEvents(response.body!);

    expect(events[0]).toEqual({
      type: "sources",
      sources: [
        { title: "必应搜索结果一", url: "https://www.bing.com/" },
        { title: "必应搜索结果二", url: "https://cn.bing.com/" },
      ],
    });
    expect(events.at(-1)).toEqual({ type: "done", truncated: false });
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
