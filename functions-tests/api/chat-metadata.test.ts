import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookie, signSession } from "../../functions/_shared/session";
import { collectClientEvents } from "../../functions/_shared/stream";
import { onRequestPost } from "../../functions/api/chat";

const providerFetch = vi.fn<typeof fetch>();

function metadataMessages(generateTitle = true): { role: "user"; text: string }[] {
  return [
    { role: "user", text: JSON.stringify({ generateTitle, updateMemory: true, existingMemory: "" }) },
    { role: "user", text: JSON.stringify({ userText: "请检查今天的天气" }) },
    { role: "user", text: JSON.stringify({ assistantText: "今天有小雨。" }) },
  ];
}

async function invoke(body: Record<string, unknown>, mock = false): Promise<Response> {
  const token = await signSession(
    { sid: crypto.randomUUID(), exp: Date.now() + 60_000 },
    env.SESSION_SIGNING_SECRET,
  );
  return onRequestPost({
    request: new Request("https://yachiyo.test/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://yachiyo.test",
        cookie: sessionCookie(token).split(";", 1)[0]!,
      },
      body: JSON.stringify(body),
    }),
    env: mock ? { ...env, APP_MODE: "mock" } : env,
  });
}

beforeEach(() => {
  providerFetch.mockReset();
  providerFetch.mockRejectedValue(new Error("不应发起额外请求"));
  vi.stubGlobal("fetch", providerFetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/chat 后台整理", () => {
  it.each([
    { mode: "metadata", useUserKey: true },
    { mode: "metadata", useUserKey: false },
    { mode: "summary", useUserKey: true },
    { mode: "summary", useUserKey: false },
  ])("$mode 自带密钥=$useUserKey 时完整传输长记忆并跳过搜索", async ({ mode, useUserKey }) => {
    const output = mode === "metadata"
      ? JSON.stringify({ title: "日常偏好", memory: "记".repeat(2000) })
      : `<conversation_memory>${"记".repeat(2000)}</conversation_memory>`;
    providerFetch.mockResolvedValueOnce(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));
    const response = await invoke({
      locale: "zh-CN",
      mode,
      webSearch: true,
      messages: mode === "metadata" ? metadataMessages() : [{ role: "user", text: "请检查今天的天气" }],
      ...(useUserKey ? { provider: "glm", model: "glm-4.7-flash", apiKey: "test-metadata-key-with-enough-length" } : {}),
    });
    expect(response.status).toBe(200);
    const events = await collectClientEvents(response.body!);
    expect(events.filter((event) => event.type === "delta").map((event) => event.text).join("")).toBe(output);
    expect(events).toContainEqual({ type: "done", truncated: false });
    expect(events.some((event) => event.type === "sources")).toBe(false);
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it.each([true, false])("mock 返回合法 JSON 并遵守 generateTitle=%s", async (generateTitle) => {
    const response = await invoke({
      locale: "zh-CN",
      mode: "metadata",
      webSearch: true,
      messages: metadataMessages(generateTitle),
    }, true);
    expect(response.status).toBe(200);
    const events = await collectClientEvents(response.body!);
    const output = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
    expect(JSON.parse(output)).toEqual({ title: generateTitle ? "日常闲聊" : null, memory: null });
    expect(events.some((event) => event.type === "sources")).toBe(false);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("按 JSON 编码后的长度为完整记忆保留传输空间", async () => {
    const memory = '喜"'.repeat(1000);
    const output = JSON.stringify({ title: "引用偏好", memory })
      .replaceAll("喜", "\\u559c");
    expect(output.length).toBeGreaterThan(4000);
    providerFetch.mockResolvedValueOnce(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));
    const response = await invoke({ locale: "zh-CN", mode: "metadata", messages: metadataMessages() });
    const events = await collectClientEvents(response.body!);
    const received = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
    expect(JSON.parse(received)).toEqual({ title: "引用偏好", memory });
    expect(events).toContainEqual({ type: "done", truncated: false });
  });

  it("拒绝错误元数据载荷且不调用上游", async () => {
    const response = await invoke({
      locale: "zh-CN", mode: "metadata", messages: [{ role: "user", text: "普通聊天原文" }],
    });
    expect(response.status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "ja-JP"])("%s mock 摘要只返回会话记忆区块", async (locale) => {
    const response = await invoke({
      locale, mode: "summary", webSearch: true, messages: [{ role: "user", text: "整理会话" }],
    }, true);
    const events = await collectClientEvents(response.body!);
    const output = events.filter((event) => event.type === "delta").map((event) => event.text).join("");
    expect(output).toMatch(/^<conversation_memory>[^<>]+<\/conversation_memory>$/u);
    expect(events.some((event) => event.type === "sources")).toBe(false);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
