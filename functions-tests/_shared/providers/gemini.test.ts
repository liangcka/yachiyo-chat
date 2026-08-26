import { describe, expect, it } from "vitest";
import type { ClientChatRequest } from "../../../functions/_shared/validation";
import type { EnrichedChatRequest } from "../../../functions/_shared/web-search";
import {
  buildGeminiAdapter,
  buildGeminiBody,
  extractGeminiDeltaText,
} from "../../../functions/_shared/providers/gemini";

const textRequest: ClientChatRequest = {
  locale: "zh-CN",
  messages: [
    { role: "assistant", text: "彩叶~" },
    { role: "user", text: "今天有点累" },
  ],
};

describe("buildGeminiBody", () => {
  it("drops leading model message so history starts with user and sets systemInstruction", () => {
    const body = buildGeminiBody(textRequest) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { maxOutputTokens: number; thinkingConfig?: { thinkingLevel?: string } };
    };

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "今天有点累" }] },
    ]);
    expect(body.systemInstruction.parts[0]?.text).toContain("月见八千代");
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("merges adjacent same-role messages to enforce strict user/model alternation", () => {
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [
        { role: "user", text: "前情提要记忆" },
        { role: "assistant", text: "已记住记忆" },
        { role: "assistant", text: "彩叶~" },
        { role: "user", text: "第一句" },
        { role: "user", text: "第二句" },
      ],
    };
    const body = buildGeminiBody(request) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "前情提要记忆" }] },
      { role: "model", parts: [{ text: "已记住记忆" }, { text: "彩叶~" }] },
      { role: "user", parts: [{ text: "第一句" }, { text: "第二句" }] },
    ]);
  });

  it("sets 4096 maxOutputTokens and summary prompt for summary mode", () => {
    const body = buildGeminiBody({ ...textRequest, mode: "summary" }) as {
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.systemInstruction.parts[0]?.text).toContain("对话记忆整理助手");
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
  });

  it("maps image data URLs into Gemini inlineData parts and merges adjacent user parts", () => {
    const imageDataUrl = "data:image/jpeg;base64,/9j/4AAQ";
    const request: ClientChatRequest = {
      locale: "zh-CN",
      messages: [
        { role: "user", text: "看图", imageDataUrl },
        { role: "user", text: "好看吗？" },
      ],
    };
    const body = buildGeminiBody(request) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };

    expect(body.contents).toHaveLength(1);
    expect(body.contents[0]?.parts).toEqual([
      { text: "看图" },
      { inlineData: { mimeType: "image/jpeg", data: "/9j/4AAQ" } },
      { text: "好看吗？" },
    ]);
  });

  it("injects web search results and the 1000-character rule into the system instruction", () => {
    const request: EnrichedChatRequest = {
      ...textRequest,
      webSearch: true,
      searchResults: [
        { title: "上海天气", url: "https://weather.example.cn/", snippet: "今日多云，24至30度。" },
      ],
    };
    const body = buildGeminiBody(request) as {
      systemInstruction: { parts: Array<{ text: string }> };
    };
    const system = body.systemInstruction.parts[0]?.text ?? "";

    expect(system).toContain("<web_search_results>");
    expect(system).toContain("[1] 上海天气（https://weather.example.cn/）");
    expect(system).toContain("今日多云，24至30度。");
    expect(system).toContain("输出最多1000个Unicode字符");
    expect(system).not.toContain("最多200个Unicode字符");
  });
});

describe("extractGeminiDeltaText", () => {
  it("reads concatenated text from parts", () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "彩叶" }, { text: "辛苦啦" }], role: "model" } }],
    });
    expect(extractGeminiDeltaText(data)).toEqual({ content: "彩叶辛苦啦", thought: null });
  });

  it("distinguishes thought parts from regular content parts", () => {
    const data = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: "思考过程...", thought: true },
              { text: "正式回复", thought: false },
            ],
            role: "model",
          },
        },
      ],
    });
    expect(extractGeminiDeltaText(data)).toEqual({
      content: "正式回复",
      thought: "思考过程...",
    });
  });

  it("extracts usageMetadata when present", () => {
    const data = JSON.stringify({
      candidates: [],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10, totalTokenCount: 25 },
    });
    expect(extractGeminiDeltaText(data)).toEqual({
      usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
    });
  });

  it("returns null for [DONE] and empty candidates without usage", () => {
    expect(extractGeminiDeltaText("[DONE]")).toBeNull();
    const empty = JSON.stringify({ candidates: [] });
    expect(extractGeminiDeltaText(empty)).toBeNull();
  });

  it("throws on malformed data", () => {
    expect(() => extractGeminiDeltaText("not-json")).toThrow(TypeError);
  });
});

describe("buildGeminiAdapter", () => {
  const adapter = buildGeminiAdapter();

  it("exposes the gemini provider metadata", () => {
    expect(adapter.id).toBe("gemini");
    expect(adapter.isOpenAICompat).toBe(false);
    expect(adapter.supportsImage).toBe(true);
    expect(adapter.defaultModel).toBe("gemini-3.7-flash");
    expect(adapter.allowedModels).toContain("gemini-3.5-flash");
  });

  it("builds a streamGenerateContent URL with x-goog-api-key header", () => {
    const built = adapter.buildRequest({
      request: textRequest,
      apiKey: "AIza" + "a".repeat(35),
      model: "gemini-3.6-flash",
    });

    expect(built.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse",
    );
    expect(built.headers["x-goog-api-key"]).toMatch(/^AIza/u);
    expect(built.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(built.body) as { contents: unknown[]; generationConfig: { maxOutputTokens: number } };
    expect(Array.isArray(body.contents)).toBe(true);
    expect(body.generationConfig.maxOutputTokens).toBe(8192);
  });
});
