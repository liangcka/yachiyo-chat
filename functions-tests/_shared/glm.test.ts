import { describe, expect, it, vi } from "vitest";
import type { ClientChatRequest } from "../../functions/_shared/validation";
import type { EnrichedChatRequest } from "../../functions/_shared/web-search";
import { requestGlm, resolveGlmConfiguration } from "../../functions/_shared/glm";

describe("resolveGlmConfiguration", () => {
  it("accepts only the fixed GLM endpoint and requested model", () => {
    const valid = {
      GLM_API_KEY: "test-key",
      GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      GLM_MODEL: "glm-4.7-flash",
    };

    expect(resolveGlmConfiguration(valid)).toEqual({
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "test-key",
      model: "glm-4.7-flash",
    });
    expect(
      resolveGlmConfiguration({
        ...valid,
        GLM_BASE_URL: "https://attacker.test/api/paas/v4",
      }),
    ).toBeNull();
    expect(
      resolveGlmConfiguration({ ...valid, GLM_MODEL: "glm-4-flash" }),
    ).toBeNull();
    expect(
      resolveGlmConfiguration({ ...valid, GLM_API_KEY: "" }),
    ).toBeNull();
  });
});

describe("requestGlm", () => {
  it("builds and sends an OpenAI-compatible request with GLM thinking and temperature", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const request: ClientChatRequest = {
        locale: "zh-CN",
        messages: [
          { role: "assistant", text: "彩叶~" },
          { role: "user", text: "今天有点累" },
        ],
      };
      const config = {
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        apiKey: "test-glm-key",
        model: "glm-4.7-flash" as const,
      };

      const abortController = new AbortController();
      const response = await requestGlm(request, config, abortController.signal);

      expect(response.status).toBe(200);
      expect(capturedUrl).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
      expect(capturedInit?.method).toBe("POST");
      expect(capturedInit?.headers).toMatchObject({
        accept: "text/event-stream",
        authorization: "Bearer test-glm-key",
        "content-type": "application/json",
      });

      const body = JSON.parse(String(capturedInit?.body));
      expect(body).toMatchObject({
        model: "glm-4.7-flash",
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        temperature: 0.8,
        max_tokens: 8192,
      });
      expect(body.messages[0]).toMatchObject({
        role: "system",
        content: expect.stringContaining("月见八千代"),
      });
      expect(body.messages.slice(1)).toEqual([
        { role: "assistant", content: "彩叶~" },
        { role: "user", content: "今天有点累" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("injects web search results and 1000-char rule into system prompt", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const request: EnrichedChatRequest = {
        locale: "zh-CN",
        webSearch: true,
        messages: [{ role: "user", text: "今天上海天气" }],
        searchResults: [
          { title: "上海天气", url: "https://weather.example.cn/", snippet: "今日多云，24至30度。" },
        ],
      };
      const config = {
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        apiKey: "test-glm-key",
        model: "glm-4.7-flash" as const,
      };

      await requestGlm(request, config, new AbortController().signal);
      const body = JSON.parse(String(capturedInit?.body));
      const system = body.messages[0];

      expect(system).toMatchObject({ role: "system" });
      expect(system.content).toContain("<web_search_results>");
      expect(system.content).toContain("[1] 上海天气（https://weather.example.cn/）");
      expect(system.content).toContain("今日多云，24至30度。");
      expect(system.content).toContain("输出最多1000个Unicode字符");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
