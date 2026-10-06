import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import type { EnrichedChatRequest } from "../../../functions/_shared/web-search";
import {
  buildOpenAICompatAdapter,
  buildOpenAICompatBody,
  extractOpenAIDeltaText,
} from "../../../functions/_shared/providers/openai-compat";

const textRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

describe("buildOpenAICompatBody", () => {
  it("maps history to OpenAI chat completions format with system prompt", () => {
    const body = buildOpenAICompatBody(textRequest, "gpt-5.6-luna", true) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      stream: boolean;
      max_tokens: number;
      reasoning_effort?: string;
    };

    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(8192);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.messages[0]?.role).toBe("system");
    expect(typeof body.messages[0]?.content).toBe("string");
    expect(body.messages.slice(1)).toEqual([
      { role: "assistant", content: "彩叶~" },
      { role: "user", content: "今天有点累" },
    ]);
  });

  it("sets reasoning_effort low for reasoning-capable providers and lifts it for images", () => {
    const imageDataUrl = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const textBody = buildOpenAICompatBody(textRequest, "step-3.7-flash", true, true) as {
      reasoning_effort?: string;
    };
    expect(textBody.reasoning_effort).toBe("low");

    const imageRequest: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "看图", imageDataUrl }],
    };
    const imageBody = buildOpenAICompatBody(imageRequest, "step-3.7-flash", true, true) as {
      reasoning_effort?: string;
    };
    expect(imageBody.reasoning_effort).toBe("medium");
  });

  it("injects thinking enabled and reasoning_effort for deepseekThinking providers", () => {
    const textBody = buildOpenAICompatBody(textRequest, "deepseek-flash", true, false, true) as {
      thinking?: { type: string };
      reasoning_effort?: string;
    };
    expect(textBody.thinking).toEqual({ type: "enabled" });
    expect(textBody.reasoning_effort).toBe("high");

    const imageDataUrl = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const imageRequest: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "看图", imageDataUrl }],
    };
    const imageBody = buildOpenAICompatBody(imageRequest, "deepseek-flash", true, false, true) as {
      thinking?: { type: string };
      reasoning_effort?: string;
    };
    expect(imageBody.thinking).toEqual({ type: "enabled" });
    expect(imageBody.reasoning_effort).toBe("medium");
  });

  it("keeps a smaller token budget for summary mode", () => {
    const body = buildOpenAICompatBody({ ...textRequest, mode: "summary" }, "gpt-5.6-luna", true) as {
      max_tokens: number;
    };
    expect(body.max_tokens).toBe(4096);
  });

  it("emits image content parts when the provider supports images", () => {
    const imageDataUrl = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const request: ClientChatRequest = {
      locale: "ja-JP",
      messages: [{ role: "user", text: "これは何？", imageDataUrl }],
    };
    const body = buildOpenAICompatBody(request, "gpt-5.6-luna", true) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "これは何？" },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    });
  });

  it("drops the image part when the provider does not support images", () => {
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [{ role: "user", text: "看图", imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
    };
    const body = buildOpenAICompatBody(request, "deepseek-chat", false) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages[1]).toEqual({ role: "user", content: "看图" });
  });

  it("injects web search results and the 1000-character rule into the system prompt", () => {
    const request: EnrichedChatRequest = {
      ...textRequest,
      webSearch: true,
      searchResults: [
        { title: "上海天气", url: "https://weather.example.cn/", snippet: "今日多云，24至30度。" },
      ],
    };
    const body = buildOpenAICompatBody(request, "gpt-5.6-luna", true) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? "";

    expect(system).toContain("<web_search_results>");
    expect(system).toContain("[1] 上海天气（https://weather.example.cn/）");
    expect(system).toContain("今日多云，24至30度。");
    expect(system).toContain("输出最多1000个Unicode字符");
    expect(system).not.toContain("最多200个Unicode字符");
  });

  it("passes currentTime to the system prompt", () => {
    const request: ClientChatRequest = {
      ...textRequest,
      currentTime: "2026-08-27 11:09:37 星期四",
    };
    const body = buildOpenAICompatBody(request, "gpt-5.6-luna", true) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages[0]?.content ?? "";
    expect(system).toContain("当前现实时间：2026-08-27 11:09:37 星期四");
  });
});

describe("extractOpenAIDeltaText", () => {
  it("reads content from OpenAI-style delta events", () => {
    const data = JSON.stringify({ choices: [{ delta: { content: "彩叶" } }] });
    expect(extractOpenAIDeltaText(data)).toEqual({ content: "彩叶", thought: null });
  });

  it("reads reasoning_content as thought", () => {
    const data = JSON.stringify({ choices: [{ delta: { reasoning_content: "思考细节..." } }] });
    expect(extractOpenAIDeltaText(data)).toEqual({ content: null, thought: "思考细节..." });
  });

  it("reads usage metadata when present in chunk", () => {
    const data = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
    });
    expect(extractOpenAIDeltaText(data)).toEqual({
      usage: { promptTokens: 42, completionTokens: 18, totalTokens: 60 },
    });
  });

  it("returns null for [DONE] and empty content", () => {
    expect(extractOpenAIDeltaText("[DONE]")).toBeNull();
    const empty = JSON.stringify({ choices: [{ delta: { content: "" } }] });
    expect(extractOpenAIDeltaText(empty)).toBeNull();
  });

  it("returns null when choices and usage are absent", () => {
    const noChoices = JSON.stringify({ choices: [] });
    expect(extractOpenAIDeltaText(noChoices)).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => extractOpenAIDeltaText("not-json")).toThrow(TypeError);
    expect(() => extractOpenAIDeltaText(JSON.stringify({ error: "x" }))).toThrow(TypeError);
  });
});

describe("buildOpenAICompatAdapter", () => {
  const adapter = buildOpenAICompatAdapter("openai", {
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.6-luna",
    allowedModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
    supportsImage: true,
    imageModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
  });

  it("exposes the provider metadata", () => {
    expect(adapter.id).toBe("openai");
    expect(adapter.isOpenAICompat).toBe(true);
    expect(adapter.supportsImage).toBe(true);
    expect(adapter.imageModels).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
    expect(adapter.defaultModel).toBe("gpt-5.6-luna");
    expect(adapter.allowedModels).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
  });

  it("builds a Bearer-authenticated streaming request", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "sk-" + "a".repeat(40),
      model: "gpt-5.6-luna",
    });

    expect(built.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(built.headers.authorization).toMatch(/^Bearer sk-/u);
    expect(built.headers.accept).toBe("text/event-stream");
    expect(built.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(built.body) as { model: string; stream: boolean };
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.stream).toBe(true);
  });

  it("handles deepseekThinking adapter request and explicitly disables thinking for judge", () => {
    const deepseekAdapter = buildOpenAICompatAdapter("deepseek", {
      endpoint: "https://api.deepseek.com/chat/completions",
      defaultModel: "deepseek-flash",
      allowedModels: ["deepseek-flash", "deepseek-v4-pro"],
      supportsImage: true,
      imageModels: ["deepseek-flash"],
      deepseekThinking: true,
    });

    const streamReq = deepseekAdapter.buildRequest({
      request: textRequest,
      apiKey: "sk-" + "b".repeat(40),
      model: "deepseek-flash",
    });
    const streamBody = JSON.parse(streamReq.body) as {
      thinking?: { type: string };
      reasoning_effort?: string;
    };
    expect(streamBody.thinking).toEqual({ type: "enabled" });
    expect(streamBody.reasoning_effort).toBe("high");

    const judgeReq = deepseekAdapter.buildJudgeRequest({
      apiKey: "sk-" + "b".repeat(40),
      model: "deepseek-flash",
      systemPrompt: "YES/NO",
      messages: [{ role: "user", text: "测试" }],
    });
    const judgeBody = JSON.parse(judgeReq.body) as {
      thinking?: { type: string };
      reasoning_effort?: string;
    };
    expect(judgeBody.thinking).toEqual({ type: "disabled" });
    expect(judgeBody.reasoning_effort).toBe("low");
  });

  it("handles glmThinking adapter routing thinking to supported models and sets roleplay temperature", () => {
    const glmAdapter = buildOpenAICompatAdapter("glm", {
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      defaultModel: "charglm-4",
      allowedModels: ["charglm-4", "glm-5.3"],
      supportsImage: true,
      imageModels: ["glm-5.3"],
      glmThinking: true,
      defaultTemperature: 0.8,
    });

    // 1. charglm-4 角色扮演专属模型：不应包含 thinking，携带 0.8 温度
    const charReq = glmAdapter.buildRequest({
      request: textRequest,
      apiKey: "sk-" + "c".repeat(40),
      model: "charglm-4",
    });
    const charBody = JSON.parse(charReq.body) as {
      thinking?: unknown;
      reasoning_effort?: unknown;
      temperature?: number;
    };
    expect(charBody.thinking).toBeUndefined();
    expect(charBody.reasoning_effort).toBeUndefined();
    expect(charBody.temperature).toBe(0.8);

    // 2. glm-5.3 深度思考模型：注入 thinking 与 reasoning_effort，并携带温度
    const thinkingReq = glmAdapter.buildRequest({
      request: textRequest,
      apiKey: "sk-" + "c".repeat(40),
      model: "glm-5.3",
    });
    const thinkingBody = JSON.parse(thinkingReq.body) as {
      thinking?: { type: string };
      reasoning_effort?: string;
      temperature?: number;
    };
    expect(thinkingBody.thinking).toEqual({ type: "enabled" });
    expect(thinkingBody.reasoning_effort).toBe("high");
    expect(thinkingBody.temperature).toBe(0.8);

    // 3. GLM judge 请求：对思考模型降低开销并固定 0.1 低温
    const judgeReq = glmAdapter.buildJudgeRequest({
      apiKey: "sk-" + "c".repeat(40),
      model: "glm-5.3",
      systemPrompt: "YES/NO",
      messages: [{ role: "user", text: "测试" }],
    });
    const judgeBody = JSON.parse(judgeReq.body) as {
      reasoning_effort?: string;
      temperature?: number;
    };
    expect(judgeBody.reasoning_effort).toBe("low");
    expect(judgeBody.temperature).toBe(0.1);
  });
});
