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
});
