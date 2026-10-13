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
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5-5");

    expect(await service.getActiveProvider()).toBe("openai");
  });

  it("force-activates when activate option is true", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5-5", {
      activate: true,
    });

    expect(await service.getActiveProvider()).toBe("claude");
  });

  it("falls back to default model when given an unknown model", async () => {
    const record = await service.saveProvider("gemini", VALID_KEY, "gemini-nonexistent");

    expect(record.model).toBe("gemini-3.8-flash");
  });

  it.each(["", "glm-unknown", "glm-4.6", "glm-4.6v-flash"])(
    "保存 GLM 配置时将无效或已移除的型号 %s 回落为 GLM-4.7-Flash",
    async (model) => {
      const record = await service.saveProvider("glm", VALID_KEY, model);

      expect(record.model).toBe("glm-4.7-flash");
      expect(await service.getActiveConfig()).toBeUndefined();
    },
  );

  it("保留用户显式选择的其他 GLM 型号", async () => {
    await service.saveProvider("glm", VALID_KEY, "charglm-4");

    expect(await service.getActiveConfig()).toMatchObject({ model: "charglm-4" });
  });

  it.each(["", VALID_KEY])("GLM-4.7-Flash 始终使用服务端，保留本地配置和个人 Key（%s）", async (apiKey) => {
    await service.saveProvider("glm", apiKey, "glm-4.7-flash");

    expect(await service.getActiveProvider()).toBe("glm");
    expect(await service.get("glm")).toMatchObject({ apiKey, model: "glm-4.7-flash" });
    expect(await service.getActiveConfig()).toBeUndefined();
  });

  it.each(["glm-4.6", "glm-4.6v-flash"])(
    "读取已保存的 %s 配置时保留用户选择",
    async (model) => {
      await service.put({ provider: "glm", apiKey: VALID_KEY, model, updatedAt: 1 });
      await service.setActiveProvider("glm");

      expect(await service.getActiveConfig()).toMatchObject({ provider: "glm", model });
      expect(await service.get("glm")).toMatchObject({ model, updatedAt: 1 });
    },
  );

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
    await service.saveProvider("claude", `  ${VALID_KEY}  `, "claude-sonnet-5-5");

    const config = await service.getActiveConfig();
    expect(config).toEqual({
      provider: "claude",
      apiKey: VALID_KEY,
      model: "claude-sonnet-5-5",
    });
  });

  it("clears the active pointer without touching other providers", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5-5", {
      activate: true,
    });

    await service.clearActiveProvider();

    expect(await service.getActiveProvider()).toBeUndefined();
    expect(await service.get("claude")).toBeDefined();
    expect(await service.get("openai")).toBeDefined();
  });

  it("clear removes a provider and resets activation when it was active", async () => {
    await service.saveProvider("openai", VALID_KEY, "gpt-5.6-luna");
    await service.saveProvider("claude", VALID_KEY, "claude-sonnet-5-5", {
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
