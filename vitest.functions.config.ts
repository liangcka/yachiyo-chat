import { createHash } from "node:crypto";
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
  GLM_API_KEY: "test-only-never-live",
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
  GLM_MODEL: "glm-4.7-flash",
  DAILY_REQUEST_LIMIT: "100",
  AUTH_ATTEMPT_LIMIT: "10",
};

export default defineConfig({
  plugins: [
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
    include: ["functions-tests/**/*.test.ts"],
  },
});
