import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPagesASSETSBinding,
  cloudflareTest,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const bindings = {
  APP_MODE: "live",
  ACCESS_CODE_SHA256: createHash("sha256")
    .update("correct horse moonlight")
    .digest("hex"),
  SESSION_SIGNING_SECRET: "test-only-signing-secret-with-32-bytes",
  STEPFUN_API_KEY: "test-only-never-live",
  STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan/v1",
  STEPFUN_MODEL: "step-3.7-flash",
  DAILY_REQUEST_LIMIT: "100",
  AUTH_ATTEMPT_LIMIT: "10",
};

const rolePromptModuleId = "\0virtual:yachiyo-role-prompt";
const rolePromptPlugin = {
  name: "yachiyo-role-prompt-test-module",
  enforce: "pre" as const,
  resolveId(source: string) {
    return source.endsWith("角色提示词.txt") ? rolePromptModuleId : null;
  },
  async load(id: string) {
    if (id !== rolePromptModuleId) {
      return null;
    }
    const prompt = await readFile(path.resolve("角色提示词.txt"), "utf8");
    return `export default ${JSON.stringify(prompt)};`;
  },
};

export default defineConfig({
  plugins: [
    rolePromptPlugin,
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: "2026-07-11",
        kvNamespaces: ["RATE_LIMIT_KV"],
        bindings,
        serviceBindings: {
          ASSETS: await buildPagesASSETSBinding(path.resolve("public")),
        },
      },
    })),
  ],
  test: {
    include: ["functions/**/*.test.ts"],
    passWithNoTests: true,
  },
});
