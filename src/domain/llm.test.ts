import { describe, expect, it } from "vitest";
import {
  DOMESTIC_PROVIDERS,
  INTERNATIONAL_PROVIDERS,
  PROVIDER_IDS,
  PROVIDER_METADATA,
  getProviderMeta,
  isProviderId,
  isValidApiKey,
} from "./llm";

describe("ProviderId", () => {
  it("exposes six supported providers", () => {
    expect(PROVIDER_IDS).toEqual(["stepfun", "deepseek", "glm", "openai", "claude", "gemini"]);
  });

  it("narrows known ids and rejects unknown values", () => {
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("claude")).toBe(true);
    expect(isProviderId("unknown")).toBe(false);
    expect(isProviderId(123)).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });
});

describe("PROVIDER_METADATA", () => {
  it("covers every provider id", () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_METADATA[id]).toBeDefined();
      expect(PROVIDER_METADATA[id].id).toBe(id);
    }
  });

  it("keeps defaultModel within each model list", () => {
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDER_METADATA[id];
      expect(meta.models).toContain(meta.defaultModel);
    }
  });

  it("splits providers into domestic and international groups", () => {
    expect(DOMESTIC_PROVIDERS).toEqual(["stepfun", "deepseek", "glm"]);
    expect(INTERNATIONAL_PROVIDERS).toEqual(["openai", "claude", "gemini"]);
    expect([...DOMESTIC_PROVIDERS, ...INTERNATIONAL_PROVIDERS].sort()).toEqual(
      [...PROVIDER_IDS].sort(),
    );
  });

  it("reports image support flags aligned with backend", () => {
    expect(PROVIDER_METADATA.stepfun.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.deepseek.supportsImage).toBe(false);
    expect(PROVIDER_METADATA.glm.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.openai.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.claude.supportsImage).toBe(true);
    expect(PROVIDER_METADATA.gemini.supportsImage).toBe(true);
  });

  it("limits imageModels to the models that actually accept images", () => {
    expect(PROVIDER_METADATA.deepseek.imageModels).toEqual([]);
    expect(PROVIDER_METADATA.glm.imageModels).toEqual(["glm-4.6v-flash", "glm-4v-flash"]);
    for (const id of PROVIDER_IDS) {
      for (const model of PROVIDER_METADATA[id].imageModels) {
        expect(PROVIDER_METADATA[id].models).toContain(model);
      }
    }
  });

  it("getProviderMeta returns the matching metadata", () => {
    expect(getProviderMeta("glm").label).toBe("智谱 GLM");
  });
});

describe("isValidApiKey", () => {
  it("accepts printable ASCII strings within length bounds", () => {
    expect(isValidApiKey("sk-" + "a".repeat(20))).toBe(true);
    expect(isValidApiKey("sk-ant-api03-abcdef0123456789")).toBe(true);
  });

  it("rejects too short, too long, and non-ASCII values", () => {
    expect(isValidApiKey("short")).toBe(false);
    expect(isValidApiKey("a".repeat(600))).toBe(false);
    expect(isValidApiKey("含中文的key-abcdefghij")).toBe(false);
    // 内部会 trim，两侧空格不影响判定
    expect(isValidApiKey("  " + "a".repeat(20) + "  ")).toBe(true);
  });
});
