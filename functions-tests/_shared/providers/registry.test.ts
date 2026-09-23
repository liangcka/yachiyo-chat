import { describe, expect, it } from "vitest";
import {
  PROVIDER_IDS,
  PROVIDERS,
  getProvider,
  isAllowedModel,
  isProviderId,
  isValidApiKey,
} from "../../../functions/_shared/providers/registry";

describe("PROVIDERS registry", () => {
  it("registers all six providers with stable ids", () => {
    expect(PROVIDER_IDS).toEqual(["stepfun", "deepseek", "glm", "openai", "claude", "gemini"]);
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id].id).toBe(id);
    }
  });

  it("marks OpenAI-compatible providers and flags image support per model", () => {
    expect(PROVIDERS.stepfun.isOpenAICompat).toBe(true);
    expect(PROVIDERS.openai.isOpenAICompat).toBe(true);
    expect(PROVIDERS.deepseek.isOpenAICompat).toBe(true);
    expect(PROVIDERS.glm.isOpenAICompat).toBe(true);
    expect(PROVIDERS.claude.isOpenAICompat).toBe(false);
    expect(PROVIDERS.gemini.isOpenAICompat).toBe(false);

    expect(PROVIDERS.deepseek.supportsImage).toBe(true);
    expect(PROVIDERS.glm.supportsImage).toBe(true);
    expect(PROVIDERS.openai.supportsImage).toBe(true);
    expect(PROVIDERS.claude.supportsImage).toBe(true);
    expect(PROVIDERS.gemini.supportsImage).toBe(true);
  });

  it("exposes per-model image support aligned with the frontend", () => {
    expect(PROVIDERS.stepfun.imageModels).toEqual(["step-5-preview", "step-3.7-flash"]);
    expect(PROVIDERS.deepseek.imageModels).toEqual(["deepseek-flash", "deepseek-v4-flash-vision-exp"]);
    expect(PROVIDERS.glm.imageModels).toEqual(["glm-5.3-flash", "glm-4.6v-flash", "glm-4v-flash"]);
    for (const id of PROVIDER_IDS) {
      for (const model of PROVIDERS[id].imageModels) {
        expect(PROVIDERS[id].allowedModels).toContain(model);
      }
    }
  });

  it("exposes default models inside the allowed model whitelist", () => {
    for (const id of PROVIDER_IDS) {
      const provider = getProvider(id);
      expect(provider.allowedModels).toContain(provider.defaultModel);
    }
  });
});

describe("isProviderId", () => {
  it("accepts known ids and rejects anything else", () => {
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("claude")).toBe(true);
    expect(isProviderId("kimi")).toBe(false);
    expect(isProviderId("")).toBe(false);
    expect(isProviderId(null)).toBe(false);
  });
});

describe("isAllowedModel", () => {
  it("validates models against the provider whitelist", () => {
    const provider = PROVIDERS.openai;
    expect(isAllowedModel(provider, "gpt-5.6-luna")).toBe(true);
    expect(isAllowedModel(provider, "gpt-5.6-sol")).toBe(true);
    expect(isAllowedModel(provider, "gpt-4o")).toBe(false);
    expect(isAllowedModel(provider, "")).toBe(false);
    expect(isAllowedModel(provider, undefined)).toBe(false);
  });
});

describe("isValidApiKey", () => {
  it("requires trimmed ASCII strings of bounded length", () => {
    expect(isValidApiKey("sk-" + "a".repeat(40))).toBe(true);
    expect(isValidApiKey("  sk-" + "a".repeat(40) + "  ")).toBe(true);
    expect(isValidApiKey("short")).toBe(false);
    expect(isValidApiKey("a".repeat(600))).toBe(false);
    expect(isValidApiKey("含中文的密钥" + "a".repeat(20))).toBe(false);
    expect(isValidApiKey(undefined)).toBe(false);
  });
});
