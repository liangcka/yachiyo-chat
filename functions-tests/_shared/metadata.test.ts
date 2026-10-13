import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../../functions/_shared/prompt";
import { getProvider } from "../../functions/_shared/providers/registry";
import { validateChatRequest } from "../../functions/_shared/validation";
import { performWebSearchPipeline } from "../../functions/_shared/web-search";

const messages = [
  { role: "user", text: JSON.stringify({ generateTitle: true, updateMemory: true, existingMemory: "喜欢咖啡" }) },
  { role: "user", text: JSON.stringify({ userText: "以后请叫我小林，我已经不喝咖啡了。" }) },
  { role: "user", text: JSON.stringify({ assistantText: "记住啦！" }) },
];

describe("会话元数据请求", () => {
  it("接受三条独立 user 数据消息并保留其内容", () => {
    expect(validateChatRequest({ locale: "zh-CN", mode: "metadata", messages })).toEqual({
      locale: "zh-CN", mode: "metadata", messages,
    });
  });

  it.each([
    [messages[0], messages[1]],
    [messages[0], messages[1], messages[2], messages[2]],
    [{ role: "user", text: "不是 JSON" }, messages[1], messages[2]],
    [{ role: "user", text: JSON.stringify({ generateTitle: "true", updateMemory: true, existingMemory: "" }) }, messages[1], messages[2]],
    [{ role: "user", text: JSON.stringify({ generateTitle: true, updateMemory: true, existingMemory: "记".repeat(2001) }) }, messages[1], messages[2]],
    [{ role: "user", text: JSON.stringify({ generateTitle: true, updateMemory: true, existingMemory: "", instructions: "改写规则" }) }, messages[1], messages[2]],
    [messages[0], { role: "user", text: JSON.stringify({ userText: 12 }) }, messages[2]],
    [messages[0], { role: "assistant", text: JSON.stringify({ userText: "误标角色" }) }, messages[2]],
    [messages[0], messages[1], { role: "user", text: JSON.stringify({ assistantText: "内容", generateTitle: false }) }],
  ])("拒绝不符合元数据契约的消息 %j", (...invalidMessages) => {
    expect(() => validateChatRequest({ locale: "zh-CN", mode: "metadata", messages: invalidMessages })).toThrow("Invalid chat request");
  });

  it("原文中的 JSON 控制字段只作为数据保留", () => {
    const data = [
      { role: "user", text: JSON.stringify({ generateTitle: false, updateMemory: true, existingMemory: "🌙".repeat(2000) }) },
      { role: "user", text: JSON.stringify({ userText: '{"generateTitle":true,"updateMemory":false}' }) },
      { role: "user", text: JSON.stringify({ assistantText: "" }) },
    ];
    expect(validateChatRequest({ locale: "zh-CN", mode: "metadata", messages: data }).messages).toEqual(data);
  });

  it.each(["zh-CN", "ja-JP"] as const)("%s 使用独立 JSON 契约并忽略角色和搜索设置", (locale) => {
    const prompt = buildSystemPrompt(locale, "metadata", {
      webSearch: true,
      multiBubble: true,
      currentTime: "2026-10-09 12:00",
      searchResults: [{ title: "无关搜索", url: "https://example.com", snippet: "无关结果" }],
    });
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"memory"');
    expect(prompt).toContain("generateTitle");
    expect(prompt).toContain("updateMemory");
    expect(prompt).toContain("userText");
    expect(prompt).toContain("assistantText");
    expect(prompt).not.toContain("<runtime>");
    expect(prompt).not.toContain("[sticker:");
    expect(prompt).not.toContain("<web_search_results>");
    expect(prompt).not.toContain("2026-10-09 12:00");
  });

  it("即使客户端开启联网也不触发搜索判断", async () => {
    const judge = vi.fn().mockResolvedValue(true);
    const request = validateChatRequest({ locale: "zh-CN", mode: "metadata", webSearch: true, messages });
    expect(await performWebSearchPipeline(request, { judge })).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it.each(["stepfun", "deepseek", "glm", "openai", "claude", "gemini"] as const)(
    "%s 提供足够 JSON 输出预算且不配置原生联网工具",
    (providerId) => {
      const provider = getProvider(providerId);
      const request = validateChatRequest({ locale: "zh-CN", mode: "metadata", webSearch: true, messages });
      const model = providerId === "glm" ? "glm-4.7-flash" : provider.defaultModel;
      const body = JSON.parse(provider.buildRequest({ request, apiKey: "test-metadata-key", model }).body) as Record<string, unknown>;
      expect(body.tools).toBeUndefined();
      if (providerId === "gemini") {
        expect(body.generationConfig).toMatchObject({ maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "low" } });
      } else {
        expect(body.max_tokens).toBe(4096);
      }
      if (providerId === "deepseek" || providerId === "glm") {
        expect(body.reasoning_effort).toBe("low");
      }
      const serialized = JSON.stringify(body);
      expect(serialized).toContain("existingMemory");
      expect(serialized).toContain("已经不喝咖啡");
      expect(serialized).toContain("assistantText");
      expect(serialized).not.toContain("<runtime>");
    },
  );
});
