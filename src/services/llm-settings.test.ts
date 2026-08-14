import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YachiyoDatabase } from "../data/db";
import { LlmSettingsService } from "./llm-settings";

const VALID_KEY = "sk-test-abcdefghijklmnopqrstuvwxyz0123";

describe("LlmSettingsService", () => {
  let db: YachiyoDatabase;
  let service: LlmSettingsService;

  beforeEach(() => {
    db = new YachiyoDatabase(`yachiyo-llm-test-${crypto.randomUUID()}`);
    service = new LlmSettingsService(db);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("returns undefined when no config is stored", async () => {
    expect(await service.get("openai")).toBeUndefined();
    expect(await service.list()).toEqual([]);
    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("saves a provider config and auto-activates the first one", async () => {
    const record = await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");

    expect(record).toMatchObject({
      provider: "openai",
      apiKey: VALID_KEY,
      model: "gpt-5.6-luna",
    });
    expect(await service.get("openai")).toMatchObject({ apiKey: VALID_KEY });
    expect(await service.getActiveProvider()).toBe("openai");
  });

  it("does not auto-activate a subsequent provider save", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5");

    expect(await service.getActiveProvider()).toBe("openai");
  });

  it("force-activates when activate option is true", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5", {
      activate: true,
    });

    expect(await service.getActiveProvider()).toBe("claude");
  });

  it("falls back to default model when given an unknown model", async () => {
    const record = await service.saveProvider("gemini", VALID_KEY, "gemini-nonexistent");

    expect(record.model).toBe("gemini-3.7-flash");
  });

  it("getActiveConfig returns undefined when active provider has no record", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.clear("openai");

    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("getActiveConfig returns undefined when stored key is invalid", async () => {
    await service.saveProvider("openai", "tooshort", "gpt-5.6-luna");

    // saveProvider 不校验 key 长度，仅在读取激活配置时判定
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it("getActiveConfig returns trimmed key and configured model", async () => {
    await service.saveProvider("claude", `  ${VALID_KEY}  `, "claude-sonnet-5");

    const config = await service.getActiveConfig();
    expect(config).toEqual({
      provider: "claude",
      apiKey: VALID_KEY,
      model: "claude-sonnet-5",
    });
  });

  it("clears the active pointer without touching other providers", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5", {
      activate: true,
    });

    await service.clearActiveProvider();

    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.get("claude")).toBeDefined();
    expect(await service.get("openai")).toBeDefined();
  });

  it("clear removes a provider and resets activation when it was active", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5", {
      activate: true,
    });

    await service.clear("claude");

    expect(await service.get("claude")).toBeUndefined();
    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.list()).toHaveLength(1);
  });

  it("clearAll wipes every provider and the active pointer", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("glm", VALID_KEY, "glm-4.7-flash");

    await service.clearAll();

    expect(await service.list()).toEqual([]);
    expect(await service.getActiveProvider()).toBeUndefined();
  });

  it("keeps locale setting intact when clearing llm data", async () => {
    await db.settings.put({ key: "locale", value: "ja-JP" });
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");

    await service.clearAll();

    expect(await db.settings.get("locale")).toEqual({ key: "locale", value: "ja-JP" });
  });
});
