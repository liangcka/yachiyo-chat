# Yachiyo Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first Cloudflare Pages PWA that faithfully recreates the supplied starry glass UI, authenticates a small invited group, streams `step-3.7-flash` role-play replies, understands captured images, switches between Chinese and Japanese, and keeps chat history on-device.

**Architecture:** A React/TypeScript/Vite static client owns presentation, IndexedDB persistence, image processing, and streamed chat state. Cloudflare Pages Functions own access-code sessions, KV-backed daily quotas, the canonical Yachiyo role prompt, StepFun request mapping, and sanitized SSE output. The browser talks only to same-origin `/api/*` routes, so StepFun credentials never enter the client bundle.

**Tech Stack:** Node.js 22.12+, npm, React, TypeScript, Vite, Dexie, Lucide React, Vitest 4.1+, Testing Library, fake-indexeddb, Cloudflare Pages Functions, Wrangler, Workers KV, `@cloudflare/vitest-pool-workers`, vite-plugin-pwa/Workbox, Playwright, ESLint.

## Global Constraints

- Use Node.js 22.12 or newer; Vite's supported floor is Node.js 20.19 or 22.12.
- Treat `docs/superpowers/specs/2026-07-11-yachiyo-chat-design.md` as the product contract.
- Treat the supplied UI image as the only visual reference; do not introduce a separate visual direction.
- Treat root `角色提示词.txt` as the canonical role prompt; bundle it only into Pages Functions, never into `dist/`.
- AI replies must preserve the 月见八千代/酒寄彩叶 roles, include parenthesized actions, prefer 15–50 Unicode characters, and never exceed 200 Unicode characters.
- Use `https://api.stepfun.com/step_plan/v1/chat/completions` with model `step-3.7-flash`; use `reasoning_effort: "low"` for text and `"medium"` for image input.
- Keep microphone, speaker, and emotion controls as disabled reserved controls in this release.
- Keep conversations, compressed images, and locale only in IndexedDB; do not create a server-side chat database.
- Never write a real StepFun key, access code, access-code digest, or signing secret to source, tests, fixtures, logs, browser storage, or Git.
- The key previously pasted into chat must not be used; deployment requires a rotated key supplied through Cloudflare Secrets.
- Validate at 320, 375, 390, 430, 768, 1024, and 1440 CSS pixels; use 390 × 844 for screenshot comparison.
- Every behavior change follows red-green-refactor, passes focused tests, and ends in an atomic commit.

---

## File Map

### Project and tooling

- `.gitignore` — dependencies, build output, Wrangler state, secrets, local screenshots, and Playwright output.
- `.dev.vars.example` — variable names and safe local instructions only.
- `package.json` / `package-lock.json` — scripts and pinned dependency graph.
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `functions/tsconfig.json` — separate browser, tooling, and Workers type domains.
- `eslint.config.js` — React, TypeScript, accessibility-safe lint baseline.
- `vite.config.ts` — React and PWA plugins, manifest, offline cache exclusions.
- `vitest.config.ts` — jsdom client tests.
- `vitest.functions.config.ts` — workerd Pages Function tests with KV and fake environment bindings.
- `playwright.config.ts` — Chromium mobile/desktop acceptance harness.
- `wrangler.jsonc` — local Pages Functions compatibility date and non-secret defaults; production bindings remain dashboard-managed.
- `index.html` — PWA shell metadata.
- `public/yachiyo-mark.svg` — code-native moon/star app mark.
- `public/_headers` — CSP and security headers.
- `public/_redirects` — SPA fallback.

### Browser application

- `src/main.tsx`, `src/App.tsx` — root render and application composition.
- `src/styles/tokens.css`, `src/styles/global.css`, `src/styles/chat.css` — exact palette, glass surfaces, layout, responsive and reduced-motion rules.
- `src/domain/chat.ts` — shared browser domain types and reducer contracts.
- `src/i18n/messages.ts` — complete `zh-CN` and `ja-JP` UI dictionaries.
- `src/data/db.ts`, `src/data/conversation-repository.ts` — Dexie schema and repository.
- `src/services/session-client.ts`, `src/services/chat-client.ts` — same-origin API clients and SSE parsing.
- `src/app/chat-reducer.ts`, `src/app/use-chat-controller.ts` — deterministic state transitions and orchestration.
- `src/features/capture/image-processor.ts`, `src/features/capture/CaptureButton.tsx` — image validation, resize/compression, camera/file input.
- `src/components/StarfieldCanvas.tsx`, `TopControls.tsx`, `ConversationView.tsx`, `MessageBubble.tsx`, `ControlDock.tsx`, `Composer.tsx`, `AccessGate.tsx`, `MenuDrawer.tsx`, `HistoryPanel.tsx`, `ToastRegion.tsx` — focused visual and interaction units.
- `src/pwa/use-online-status.ts`, `src/pwa/UpdatePrompt.tsx` — offline/read-only state and controlled service-worker updates.
- `src/test/setup.ts` — Testing Library, matchMedia, ResizeObserver, canvas and IndexedDB setup.

### Pages Functions

- `functions/runtime-types.d.ts`, `functions/types.d.ts`, `functions/text-modules.d.ts` — generated Workers runtime types plus Env, KV and `.txt` module declarations.
- `functions/_shared/http.ts` — JSON/SSE responses and sanitized error codes.
- `functions/_shared/crypto.ts` — SHA-256, constant-time comparison, base64url and HMAC helpers.
- `functions/_shared/session.ts` — signed HttpOnly device session cookie.
- `functions/_shared/rate-limit.ts` — UTC-day chat quota and privacy-preserving access-code attempt limits.
- `functions/_shared/validation.ts` — same-origin, body, history, text and image limits.
- `functions/_shared/prompt.ts` — server-only import of `角色提示词.txt` and locale suffix composition.
- `functions/_shared/stepfun.ts` — StepFun payload creation and outbound request.
- `functions/_shared/stream.ts` — StepFun SSE parsing, 200-character cap, sanitized client SSE.
- `functions/api/session.ts` — GET/POST/DELETE session route.
- `functions/api/chat.ts` — authenticated, rate-limited streaming chat route.

### Tests and documentation

- Colocated `*.test.ts(x)` files — client unit/component tests.
- `functions/**/*.test.ts` — workerd tests for Pages Functions.
- `e2e/yachiyo-chat.spec.ts` — primary user journeys and responsive assertions.
- `README.md` — local setup, rotated-secret configuration, Cloudflare Pages deployment, KV binding, and verification commands.

---

### Task 1: Scaffold the tested React, Workers, and PWA foundation

**Files:**
- Create: `.gitignore`
- Create: `.dev.vars.example`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `eslint.config.js`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `vitest.functions.config.ts`
- Create: `wrangler.jsonc`
- Create: `index.html`
- Create: `public/yachiyo-mark.svg`
- Create: `src/vite-env.d.ts`
- Create: `src/test/setup.ts`
- Create: `src/main.tsx`
- Create: `src/App.test.tsx`
- Create: `src/App.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `functions/types.d.ts`
- Create: `functions/runtime-types.d.ts`
- Create: `functions/text-modules.d.ts`
- Create: `functions/tsconfig.json`

**Interfaces:**
- Consumes: root Git repository, approved spec, and canonical `角色提示词.txt`.
- Produces: `npm run dev`, `npm run test:unit`, `npm run test:functions`, `npm run typecheck`, `npm run lint`, `npm run build`, and a renderable `<App />` shell.

- [ ] **Step 1: Define scripts and install the exact toolchain**

Create `package.json` with these scripts before installing dependencies:

```json
{
  "name": "yachiyo-chat",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:pages": "npm run build && wrangler pages dev dist -c wrangler.jsonc --kv RATE_LIMIT_KV",
    "dev:mock": "npm run build && wrangler pages dev dist -c wrangler.jsonc --kv RATE_LIMIT_KV --binding APP_MODE=mock",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint .",
    "test": "npm run test:unit && npm run test:functions",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:functions": "vitest run --config vitest.functions.config.ts",
    "test:e2e": "playwright test",
    "cf:types": "wrangler types --path=./functions/runtime-types.d.ts"
  }
}
```

Install runtime packages `react`, `react-dom`, `dexie`, and `lucide-react`. Install development packages `typescript`, `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `workbox-window`, `vitest@^4.1.0`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `fake-indexeddb`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `eslint-plugin-jsx-a11y`, `@types/node`, `@types/react`, `@types/react-dom`, `wrangler`, `@cloudflare/vitest-pool-workers`, and `@playwright/test` using `npm --cache` so `package-lock.json` pins the resolved graph.

- [ ] **Step 2: Write the failing application shell test**

```tsx
// src/App.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the Yachiyo application landmark", () => {
    render(<App />);
    expect(screen.getByRole("main", { name: "Yachiyo Chat" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the smoke test and confirm red**

Run: `npm run test:unit -- src/App.test.tsx`

Expected: FAIL because `src/App.tsx` does not exist.

- [ ] **Step 4: Add configs and the minimal shell implementation**

Use a project-reference TypeScript setup: browser files include `DOM`/`DOM.Iterable`; tooling files use Node types; `functions/tsconfig.json` uses `ESNext` and generated Workers types. Configure Vitest jsdom with `src/test/setup.ts`, fake IndexedDB, `@testing-library/jest-dom/vitest`, deterministic `matchMedia`, and no real network.

Configure `vite.config.ts` with React and `VitePWA({ registerType: "prompt", strategies: "generateSW" })`. The manifest must use `Yachiyo Chat`, `Yachiyo`, `standalone`, portrait orientation, `#07102d` background, `#142d67` theme, and `/yachiyo-mark.svg` with `sizes: "any"`. Workbox must navigate-fallback to `/index.html` and denylist `/api/`.

```tsx
// src/App.tsx
export function App() {
  return (
    <main className="app-shell" aria-label="Yachiyo Chat">
      <div className="app-shell__backdrop" aria-hidden="true" />
    </main>
  );
}
```

```css
/* src/styles/tokens.css */
:root {
  --space-0: #050817;
  --space-1: #07183e;
  --space-2: #123d78;
  --glass: rgb(191 205 232 / 28%);
  --glass-strong: rgb(221 228 242 / 72%);
  --glass-border: rgb(255 255 255 / 18%);
  --text-primary: #f7f8fc;
  --text-muted: #d3d9e7;
  --danger: #bf1323;
  --radius-card: 1.5rem;
  --radius-control: 999px;
}
```

`wrangler.jsonc` must set compatibility date `2026-07-11` and non-secret defaults for `STEPFUN_BASE_URL`, `STEPFUN_MODEL`, `DAILY_REQUEST_LIMIT`, and `AUTH_ATTEMPT_LIMIT`, but omit `pages_build_output_dir` and all production KV IDs so dashboard configuration remains authoritative.

- [ ] **Step 5: Verify the foundation**

Run: `npm run test:unit -- src/App.test.tsx`

Expected: 1 passing test.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run lint`

Expected: exit 0.

Run: `npm run build`

Expected: Vite emits `dist/`, a manifest, and a generated service worker; no `/api/` response is precached.

- [ ] **Step 6: Commit the foundation**

```bash
git add .gitignore .dev.vars.example package.json package-lock.json tsconfig*.json eslint.config.js vite.config.ts vitest*.ts wrangler.jsonc index.html public src functions
git commit -m "chore: scaffold Yachiyo PWA foundation"
```

---

### Task 2: Add bilingual domain models and IndexedDB persistence

**Files:**
- Create: `src/domain/chat.ts`
- Create: `src/i18n/messages.ts`
- Create: `src/i18n/messages.test.ts`
- Create: `src/data/db.ts`
- Create: `src/data/conversation-repository.ts`
- Create: `src/data/conversation-repository.test.ts`

**Interfaces:**
- Consumes: Dexie and fake-indexeddb from Task 1.
- Produces: `Locale`, `Conversation`, `ChatMessage`, `StoredImage`, `UiCopy`, `copyFor(locale)`, `YachiyoDatabase`, and `ConversationRepository` methods used by Tasks 5 and 8.

- [ ] **Step 1: Write failing locale and repository tests**

```ts
// src/i18n/messages.test.ts
import { describe, expect, it } from "vitest";
import { copyFor } from "./messages";

describe("copyFor", () => {
  it("returns complete Chinese and Japanese controls", () => {
    expect(copyFor("zh-CN").capture).toBe("拍摄");
    expect(copyFor("ja-JP").capture).toBe("撮影");
    expect(copyFor("ja-JP").voiceSoon).not.toBe(copyFor("zh-CN").voiceSoon);
  });
});
```

```ts
// src/data/conversation-repository.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { YachiyoDatabase } from "./db";
import { ConversationRepository } from "./conversation-repository";

describe("ConversationRepository", () => {
  const db = new YachiyoDatabase(`test-${crypto.randomUUID()}`);
  const repo = new ConversationRepository(db);

  afterEach(async () => db.delete());

  it("persists and orders conversations by latest activity", async () => {
    const older = await repo.createConversation("zh-CN", 10);
    const newer = await repo.createConversation("ja-JP", 20);
    expect((await repo.listConversations()).map(({ id }) => id)).toEqual([
      newer.id,
      older.id,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm red**

Run: `npm run test:unit -- src/i18n/messages.test.ts src/data/conversation-repository.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement exact domain types and locale dictionaries**

```ts
// src/domain/chat.ts
export type Locale = "zh-CN" | "ja-JP";
export type MessageStatus = "complete" | "streaming" | "failed" | "stopped";

export interface Conversation {
  id: string;
  title: string;
  locale: Locale;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  imageId?: string;
  status: MessageStatus;
  createdAt: number;
}

export interface StoredImage {
  id: string;
  conversationId: string;
  blob: Blob;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}
```

Define one `UiCopy` interface containing every visible label and error: menu, capture, input hint, send, stop, settings, emotion, speaker, microphone, voice-soon, access-code form, history, new chat, delete, sign out, offline, retry, quota, generic failure, update-ready, and first greeting. `copyFor` must return a frozen dictionary with no optional fields.

- [ ] **Step 4: Implement the Dexie schema and repository**

Use database name `yachiyo-chat`, schema version 1, and stores:

```ts
db.version(1).stores({
  conversations: "id, updatedAt, locale",
  messages: "id, conversationId, createdAt, [conversationId+createdAt]",
  images: "id, conversationId",
  settings: "key",
});
```

`ConversationRepository` must expose:

```ts
createConversation(locale: Locale, now?: number): Promise<Conversation>
listConversations(): Promise<Conversation[]>
getConversation(id: string): Promise<Conversation | undefined>
renameConversation(id: string, title: string): Promise<void>
deleteConversation(id: string): Promise<void>
listMessages(conversationId: string): Promise<ChatMessage[]>
putMessage(message: ChatMessage): Promise<void>
putImage(image: StoredImage): Promise<void>
getImage(id: string): Promise<StoredImage | undefined>
setLocale(locale: Locale): Promise<void>
getLocale(): Promise<Locale>
clearAll(): Promise<void>
```

`deleteConversation` must delete the conversation, its messages, and its images in one Dexie transaction. `createConversation` must throw a typed `ConversationLimitError` at 30 records rather than evict silently.

- [ ] **Step 5: Verify persistence and dictionaries**

Run: `npm run test:unit -- src/i18n/messages.test.ts src/data/conversation-repository.test.ts`

Expected: all locale, ordering, cascade-delete, setting, image, and 30-conversation boundary tests pass.

- [ ] **Step 6: Commit the domain slice**

```bash
git add src/domain src/i18n src/data
git commit -m "feat: add bilingual local conversation storage"
```

---

### Task 3: Implement secure device sessions and daily quotas

**Files:**
- Create: `functions/_shared/http.ts`
- Create: `functions/_shared/crypto.ts`
- Create: `functions/_shared/session.ts`
- Create: `functions/_shared/rate-limit.ts`
- Create: `functions/api/session.ts`
- Create: `functions/api/session.test.ts`
- Create: `functions/_shared/rate-limit.test.ts`

**Interfaces:**
- Consumes: `Env` from `functions/types.d.ts` and `RATE_LIMIT_KV` binding.
- Produces: `jsonResponse`, `problemResponse`, `sha256Hex`, `constantTimeEqual`, `signSession`, `verifySession`, `sessionCookie`, `clearSessionCookie`, `consumeDailyQuota`, and `/api/session` handlers used by Task 4.

- [ ] **Step 1: Write failing session route tests in workerd**

```ts
// functions/api/session.test.ts
import { createPagesEventContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "./session";

describe("/api/session", () => {
  it("issues an HttpOnly cookie for the configured access code", async () => {
    const request = new Request("https://yachiyo.test/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://yachiyo.test" },
      body: JSON.stringify({ accessCode: "correct horse moonlight" }),
    });
    const context = createPagesEventContext<typeof onRequestPost>({ request });
    const response = await onRequestPost(context);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Strict/);
  });

  it("reports unauthenticated when no cookie exists", async () => {
    const request = new Request("https://yachiyo.test/api/session");
    const context = createPagesEventContext<typeof onRequestGet>({ request });
    expect(await (await onRequestGet(context)).json()).toEqual({ authenticated: false });
  });
});
```

Configure `vitest.functions.config.ts` with `cloudflareTest({ miniflare: { compatibilityDate: "2026-07-11", kvNamespaces: ["RATE_LIMIT_KV"], bindings }})`, where `bindings` is exactly:

```ts
import { createHash } from "node:crypto";

const bindings = {
  APP_MODE: "live",
  ACCESS_CODE_SHA256: createHash("sha256")
    .update("correct horse moonlight")
    .digest("hex"),
  SESSION_SIGNING_SECRET: "test-only-signing-secret-with-32-bytes",
  STEPFUN_BASE_URL: "https://api.stepfun.com/step_plan/v1",
  STEPFUN_MODEL: "step-3.7-flash",
  DAILY_REQUEST_LIMIT: "100",
  AUTH_ATTEMPT_LIMIT: "10",
  STEPFUN_API_KEY: "test-only-never-live",
};
```

- [ ] **Step 2: Run and confirm red**

Run: `npm run test:functions -- functions/api/session.test.ts functions/_shared/rate-limit.test.ts`

Expected: FAIL because session and quota helpers do not exist.

- [ ] **Step 3: Implement cryptography and cookie format**

Use Web Crypto only. Encode a payload `{ sid, exp }` as base64url JSON and append a base64url HMAC-SHA256 signature. `verifySession` must reject malformed data, bad signatures, missing fields, and `exp <= Date.now()`.

```ts
export interface SessionPayload {
  sid: string;
  exp: number;
}

export const SESSION_COOKIE = "yachiyo_session";

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
```

Compare the access-code digest as bytes in constant time. Normalize only outer whitespace; do not lowercase or Unicode-fold the secret. Reject access codes shorter than 16 or longer than 128 Unicode characters before hashing. Before comparison, HMAC the trusted `CF-Connecting-IP` value with `SESSION_SIGNING_SECRET`, use only that digest in KV, and enforce at most 10 failed attempts per rolling 15-minute bucket. Missing/invalid IP values share a conservative anonymous bucket; raw IP addresses must never be persisted or logged.

- [ ] **Step 4: Implement session handlers and quota consumption**

`GET` returns `{ authenticated: boolean }`; `POST` accepts JSON `{ accessCode: string }`, verifies same-origin and content type, checks the server-side attempt bucket, then returns 204 with the signed cookie. Wrong codes return localized-neutral problem code `ACCESS_DENIED` with status 403 until the bucket reaches its limit; subsequent attempts return `AUTH_RATE_LIMITED` with status 429. A successful login clears the current failure bucket. `DELETE` returns 204 with the clearing cookie. When and only when `APP_MODE === "mock"`, accept the fixed local code `yachiyo-local-access` and use a fixed test-only signing key if secrets are absent; live mode must fail closed when either secret is missing.

```ts
export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetsAt: string;
}

export async function consumeDailyQuota(
  kv: KVNamespace,
  sessionId: string,
  limit: number,
  now = new Date(),
): Promise<QuotaResult>;
```

Use a UTC date key `quota:${yyyy-mm-dd}:${sid}` and `expirationTtl` equal to seconds until two hours after the next UTC midnight. Read without `cacheTtl`, increment once, write once, and document KV eventual consistency in code. Return `allowed: false` without increment when the observed count is already at the limit.

- [ ] **Step 5: Verify auth and quota boundaries**

Run: `npm run test:functions -- functions/api/session.test.ts functions/_shared/rate-limit.test.ts`

Expected: correct/wrong code, privacy-preserving IP bucket, 10-attempt rejection, successful-login counter reset, tampered/expired cookie, sign-out, quota increment, quota rejection, and UTC rollover tests pass.

- [ ] **Step 6: Commit the secure session slice**

```bash
git add functions .dev.vars.example vitest.functions.config.ts
git commit -m "feat: add signed device sessions and quotas"
```

---

### Task 4: Build the role-aware StepFun streaming proxy

**Files:**
- Create: `functions/_shared/validation.ts`
- Create: `functions/_shared/prompt.ts`
- Create: `functions/_shared/stepfun.ts`
- Create: `functions/_shared/stream.ts`
- Create: `functions/api/chat.ts`
- Create: `functions/_shared/prompt.test.ts`
- Create: `functions/_shared/stream.test.ts`
- Create: `functions/api/chat.test.ts`

**Interfaces:**
- Consumes: session/quota helpers from Task 3 and canonical `角色提示词.txt`.
- Produces: `ClientChatRequest`, `validateChatRequest`, `buildSystemPrompt`, `buildStepFunBody`, `proxyStepFunStream`, and `onRequestPost` for `/api/chat` consumed by Task 5.

- [ ] **Step 1: Write failing prompt, validation, and route tests**

```ts
// functions/_shared/prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("preserves Yachiyo canon and appends Japanese output rules", () => {
    const prompt = buildSystemPrompt("ja-JP");
    expect(prompt).toContain("月见八千代");
    expect(prompt).toContain("酒寄彩叶");
    expect(prompt).toContain("200");
    expect(prompt).toContain("自然な日本語");
  });
});
```

```ts
// functions/_shared/stream.test.ts
import { describe, expect, it } from "vitest";
import { collectClientEvents, proxyStepFunStream } from "./stream";

it("caps streamed output at 200 Unicode characters", async () => {
  const upstream = stepFunSse(["🌙".repeat(150), "八".repeat(100)]);
  const response = proxyStepFunStream(upstream);
  const events = await collectClientEvents(response.body!);
  expect([...events.filter((event) => event.type === "delta").map((event) => event.text).join("")]).toHaveLength(200);
  expect(events.at(-1)).toMatchObject({ type: "done", truncated: true });
});
```

Chat route tests must mock only `https://api.stepfun.com` with `fetchMock`, pass a signed session cookie, and assert that text uses low effort, image uses medium effort, the provider key is present only upstream, and provider error bodies are never returned to the browser.

- [ ] **Step 2: Run and confirm red**

Run: `npm run test:functions -- functions/_shared/prompt.test.ts functions/_shared/stream.test.ts functions/api/chat.test.ts`

Expected: FAIL because the modules and chat route do not exist.

- [ ] **Step 3: Implement request validation and canonical prompt composition**

```ts
export interface ClientHistoryMessage {
  role: "user" | "assistant";
  text: string;
  imageDataUrl?: string;
}

export interface ClientChatRequest {
  locale: "zh-CN" | "ja-JP";
  messages: ClientHistoryMessage[];
}
```

Accept at most 20 messages, 4,000 Unicode characters per message, and 24,000 characters total. Permit one image only on the last user message. Permit only `data:image/jpeg`, `data:image/png`, and `data:image/webp`; estimate decoded bytes from base64 and reject above 2 MiB. Reject unknown fields with problem code `INVALID_REQUEST`.

Import the root prompt as a text module:

```ts
import rolePrompt from "../../角色提示词.txt";

const localeSuffix = {
  "zh-CN": "运行时语言：请使用简体中文回复。保持括号动作描写。",
  "ja-JP": "実行時言語：自然な日本語で返答してください。括弧内の動作描写を保ってください。",
} as const;

export function buildSystemPrompt(locale: keyof typeof localeSuffix): string {
  return `${rolePrompt.trim()}\n\n<runtime>\n${localeSuffix[locale]}\n平台安全、隐私与紧急风险规则始终优先。输出最多200个Unicode字符，优先15至50字符。\n</runtime>`;
}
```

- [ ] **Step 4: Implement StepFun mapping and sanitized SSE**

`buildStepFunBody` must create one system message followed by validated history. Convert image input to OpenAI-compatible content parts with `{ type: "text", text }` and `{ type: "image_url", image_url: { url } }`. Set `stream: true`, selected model, `reasoning_effort`, and a conservative output-token ceiling.

`proxyStepFunStream` must incrementally parse `data:` records, ignore `[DONE]`, extract `choices[0].delta.content`, count Unicode code points, and emit only:

```text
event: delta
data: {"text":"..."}

event: done
data: {"truncated":false}

```

On parse/provider failure after headers, emit `event: error` with a stable code and close. Abort the upstream fetch when the browser signal aborts or the 200-character cap is reached.

`APP_MODE=mock` must bypass StepFun and emit deterministic localized Yachiyo lines through the same client SSE format. Any other mode requires `STEPFUN_API_KEY`; missing configuration returns sanitized 503.

- [ ] **Step 5: Verify the proxy**

Run: `npm run test:functions -- functions/_shared/prompt.test.ts functions/_shared/stream.test.ts functions/api/chat.test.ts`

Expected: validation, canonical prompt, text/image payload, auth, quota, mock mode, provider failure, abort, Unicode cap, and secret-non-disclosure tests pass.

Run: `npm run typecheck`

Expected: browser and Functions projects exit 0.

- [ ] **Step 6: Commit the proxy slice**

```bash
git add functions 角色提示词.txt
git commit -m "feat: proxy role-aware StepFun chat streams"
```

---

### Task 5: Add browser API clients and deterministic chat orchestration

**Files:**
- Create: `src/services/session-client.ts`
- Create: `src/services/session-client.test.ts`
- Create: `src/services/chat-client.ts`
- Create: `src/services/chat-client.test.ts`
- Create: `src/app/chat-reducer.ts`
- Create: `src/app/chat-reducer.test.ts`
- Create: `src/app/use-chat-controller.ts`
- Create: `src/app/use-chat-controller.test.tsx`

**Interfaces:**
- Consumes: domain types/repository from Task 2 and `/api/session`, `/api/chat` from Tasks 3–4.
- Produces: `SessionClient`, `streamChat`, `ChatState`, `ChatAction`, `chatReducer`, and `useChatController` consumed by Task 8.

- [ ] **Step 1: Write failing SSE client and reducer tests**

```ts
// src/services/chat-client.test.ts
it("delivers delta events and the done result", async () => {
  serverFetch.mockResolvedValue(sseResponse([
    { type: "delta", text: "彩叶~" },
    { type: "delta", text: "辛苦啦！" },
    { type: "done", truncated: false },
  ]));
  const chunks: string[] = [];
  const result = await streamChat(sampleRequest, { onDelta: (text) => chunks.push(text) });
  expect(chunks).toEqual(["彩叶~", "辛苦啦！"]);
  expect(result).toEqual({ truncated: false });
});
```

```ts
// src/app/chat-reducer.test.ts
it("keeps partial text when generation is stopped", () => {
  const streaming = chatReducer(initialChatState, { type: "send-started", user, assistant });
  const withText = chatReducer(streaming, { type: "delta", messageId: assistant.id, text: "好~" });
  const stopped = chatReducer(withText, { type: "stopped", messageId: assistant.id });
  expect(stopped.messages.at(-1)).toMatchObject({ text: "好~", status: "stopped" });
  expect(stopped.phase).toBe("idle");
});
```

- [ ] **Step 2: Run and confirm red**

Run: `npm run test:unit -- src/services src/app`

Expected: FAIL because clients, reducer, and hook do not exist.

- [ ] **Step 3: Implement same-origin clients**

`SessionClient` exposes `check()`, `authenticate(accessCode)`, and `signOut()`, always uses `credentials: "same-origin"`, parses stable problem codes, and never logs submitted values.

`streamChat` posts validated history, checks `text/event-stream`, parses event/data records across arbitrary byte boundaries, calls `onDelta`, and returns `{ truncated }`. Map 401, 429, offline/network, provider, invalid request, and aborted request to typed `ChatClientError` codes.

- [ ] **Step 4: Implement reducer and controller**

```ts
export type ChatPhase = "loading" | "idle" | "streaming" | "offline" | "error";

export interface ChatState {
  phase: ChatPhase;
  activeConversation?: Conversation;
  messages: ChatMessage[];
  locale: Locale;
  pendingImage?: StoredImage;
  errorCode?: string;
}
```

`useChatController` must:

1. Load locale and latest conversation from the repository.
2. Create a conversation and localized first greeting when none exists.
3. Save the user message before network work.
4. Create and persist a streaming assistant message.
5. Throttle partial persistence to at most once per 250 ms.
6. Preserve partial text on stop/failure and expose retry.
7. Cancel the active `AbortController` on stop, conversation switch, and unmount.
8. Send only the last 20 valid messages and preserve image data only when needed.

- [ ] **Step 5: Verify controller state transitions**

Run: `npm run test:unit -- src/services src/app`

Expected: session, split SSE frames, send, stream, stop, retry, 401, 429, offline, persistence throttling, and unmount-abort tests pass.

- [ ] **Step 6: Commit the orchestration slice**

```bash
git add src/services src/app
git commit -m "feat: orchestrate persisted streaming chat"
```

---

### Task 6: Implement camera selection and bounded image processing

**Files:**
- Create: `src/features/capture/image-processor.ts`
- Create: `src/features/capture/image-processor.test.ts`
- Create: `src/features/capture/CaptureButton.tsx`
- Create: `src/features/capture/CaptureButton.test.tsx`

**Interfaces:**
- Consumes: `StoredImage`, locale copy, and `setPendingImage` controller action.
- Produces: `ProcessedImage`, `calculateTargetSize`, `processImage`, and `<CaptureButton onImage />` consumed by Task 8.

- [ ] **Step 1: Write failing geometry and capture tests**

```ts
import { expect, it } from "vitest";
import { calculateTargetSize } from "./image-processor";

it("keeps aspect ratio within a 1600px long edge", () => {
  expect(calculateTargetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  expect(calculateTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
});
```

Component tests must assert `accept="image/*"`, `capture="environment"`, localized accessible name, disabled state, and propagation of one processed image.

- [ ] **Step 2: Run and confirm red**

Run: `npm run test:unit -- src/features/capture`

Expected: FAIL because image processing and capture component do not exist.

- [ ] **Step 3: Implement processing with injectable browser primitives**

```ts
export interface ProcessedImage {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

export async function processImage(file: File): Promise<ProcessedImage>;
```

Reject non-JPEG/PNG/WebP input and source files over 15 MiB. Decode with `createImageBitmap(file, { imageOrientation: "from-image" })` and an `HTMLImageElement` fallback. Draw to canvas at maximum long edge 1600. Preserve transparency with WebP; otherwise encode JPEG starting at 0.82 quality. If output exceeds 2 MiB, lower quality in 0.08 steps down to 0.5, then reduce dimensions by 15% per retry. Throw `ImageProcessingError("IMAGE_TOO_LARGE")` if still over the bound.

- [ ] **Step 4: Implement the hidden camera/file input**

Use a real `<button>` and visually hidden `<input type="file">`. Reset `input.value` after every selection so the same file can be chosen again. Disable while processing, announce errors through an `aria-live` callback, and revoke every object URL on replacement/unmount.

- [ ] **Step 5: Verify image behavior**

Run: `npm run test:unit -- src/features/capture`

Expected: geometry, type/size validation, quality fallback, input attributes, same-file reselection, disabled processing, and error announcement tests pass.

- [ ] **Step 6: Commit the capture slice**

```bash
git add src/features/capture
git commit -m "feat: add bounded camera image capture"
```

---

### Task 7: Recreate the starfield glass chat interface

**Files:**
- Create: `src/components/StarfieldCanvas.tsx`
- Create: `src/components/StarfieldCanvas.test.tsx`
- Create: `src/components/TopControls.tsx`
- Create: `src/components/MessageBubble.tsx`
- Create: `src/components/ConversationView.tsx`
- Create: `src/components/ControlDock.tsx`
- Create: `src/components/Composer.tsx`
- Create: `src/components/chat-components.test.tsx`
- Create: `src/styles/chat.css`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: domain types, locale copy, capture component, and controller callbacks.
- Produces: the reference-faithful presentational chat screen consumed by Task 8.

- [ ] **Step 1: Write failing accessible component tests**

```tsx
it("renders the reference controls with localized labels", () => {
  render(<ControlDock copy={copyFor("zh-CN")} onSettings={vi.fn()} onUnavailable={vi.fn()} />);
  expect(screen.getByRole("button", { name: "设置" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "情绪功能即将开放" })).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("button", { name: "扬声器功能即将开放" })).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("button", { name: "麦克风功能即将开放" })).toHaveAttribute("aria-disabled", "true");
});
```

Tests must also assert that assistant messages use a readable region, user messages align separately, composer changes Send to Stop during streaming, Enter sends while Shift+Enter inserts a newline, and IME composition never sends prematurely.

- [ ] **Step 2: Run and confirm red**

Run: `npm run test:unit -- src/components`

Expected: FAIL because the visual components do not exist.

- [ ] **Step 3: Implement deterministic starfield and focused components**

`StarfieldCanvas` receives an optional seeded random function for tests, stores stars in refs, caps device pixel ratio at 2, pauses when `document.hidden`, and renders a static field under reduced motion. It must never capture pointer events.

Use Lucide icons `Menu`, `Camera`, `Settings`, `Smile`, `Volume2`, `Mic`, `Send`, and `Square`. Use semantic `<button>`, `<textarea>`, `<ol>`, and `<article>` elements; do not use clickable `<div>` elements.

- [ ] **Step 4: Implement the exact layout and visual tokens**

The mobile composition must follow these anchors at 390 × 844:

- safe top controls at `max(1rem, env(safe-area-inset-top)) + 0.75rem`;
- capture pill at the top right and menu at the top left;
- conversation bottom edge 12rem above the bottom safe area;
- assistant glass card width `calc(100% - 2rem)`, 1.5rem radius, readable 1.55 line height;
- four equal control pills in one row with 0.75rem gaps;
- composer row below controls with flexible input and compact action pill;
- desktop app column max-width 430px, full-height, centered without a fake phone frame.

Use subtle blue radial illumination, no purple marketing gradient, no heavy card shadows, no external background images, and no arbitrary layout changes. Add `backdrop-filter` with a readable opaque fallback. Under `prefers-reduced-motion`, remove star drift, glow breathing, and sliding transitions.

- [ ] **Step 5: Verify component behavior**

Run: `npm run test:unit -- src/components`

Expected: all semantic, localized control, composer, message, auto-scroll, reduced-motion, and canvas lifecycle tests pass.

Run: `npm run build`

Expected: CSS and TypeScript compile without warnings; `dist/` contains no role prompt text.

- [ ] **Step 6: Commit the visual slice**

```bash
git add src/components src/styles
git commit -m "feat: recreate the starfield glass chat UI"
```

---

### Task 8: Integrate access gate, menu, history, locale, and complete chat flows

**Files:**
- Create: `src/components/AccessGate.tsx`
- Create: `src/components/MenuDrawer.tsx`
- Create: `src/components/HistoryPanel.tsx`
- Create: `src/components/ToastRegion.tsx`
- Create: `src/components/app-flows.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles/chat.css`

**Interfaces:**
- Consumes: all browser interfaces from Tasks 2, 5, 6, and 7.
- Produces: complete authenticated, bilingual, locally persistent application flow.

- [ ] **Step 1: Write failing end-to-end component tests with fake clients**

```tsx
it("authenticates, sends a message, and switches to Japanese", async () => {
  const user = userEvent.setup();
  render(<App services={fakeServices({ authenticated: false })} />);

  await user.type(screen.getByLabelText("访问码"), "correct horse moonlight");
  await user.click(screen.getByRole("button", { name: "进入" }));
  expect(await screen.findByRole("main", { name: "Yachiyo Chat" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "菜单" }));
  await user.click(screen.getByRole("button", { name: "日本語" }));
  expect(screen.getByPlaceholderText("何でも話してね")).toBeVisible();
});
```

Add tests for wrong code, new chat, history switch, rename/delete, clear-all confirmation, image preview/removal, streamed reply, stop, retry, quota toast, session expiry without local deletion, and disabled controls.

- [ ] **Step 2: Run and confirm red**

Run: `npm run test:unit -- src/App.test.tsx src/components/app-flows.test.tsx`

Expected: FAIL because the full app flow is not composed.

- [ ] **Step 3: Implement access and navigation overlays**

`AccessGate` must focus the access-code field on open, disable repeated submit during the request, clear the field on failure, and never persist or log its value. `MenuDrawer` must trap focus, close on Escape/backdrop, restore opener focus, and expose new chat, history, locale, local-data deletion, and sign-out. `HistoryPanel` must keep deletion and clear-all behind confirmation.

- [ ] **Step 4: Compose App with dependency injection**

```ts
export interface AppServices {
  repository: ConversationRepository;
  session: SessionClient;
  streamChat: typeof streamChat;
  processImage: typeof processImage;
}

export interface AppProps {
  services?: AppServices;
}
```

Production defaults instantiate the real repository and clients; tests pass fakes. App startup checks the session and locale in parallel, shows a skeleton until both resolve, and never deletes local data on auth failure. Keep overlays inside the 430px app column on desktop so the visual reference remains intact.

- [ ] **Step 5: Verify integrated flows**

Run: `npm run test:unit -- src`

Expected: all client, repository, image, component, access, bilingual, history, streaming, stop, error, and focus tests pass.

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0 and `dist/` contains no secret or canonical role-prompt excerpt.

- [ ] **Step 6: Commit the integrated application**

```bash
git add src
git commit -m "feat: integrate secure bilingual chat flows"
```

---

### Task 9: Finish offline behavior, security headers, browser QA, and deployment docs

**Files:**
- Create: `src/pwa/use-online-status.ts`
- Create: `src/pwa/use-online-status.test.tsx`
- Create: `src/pwa/UpdatePrompt.tsx`
- Create: `src/pwa/UpdatePrompt.test.tsx`
- Create: `public/_headers`
- Create: `public/_redirects`
- Create: `playwright.config.ts`
- Create: `e2e/yachiyo-chat.spec.ts`
- Create: `README.md`
- Modify: `src/App.tsx`
- Modify: `vite.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete app from Task 8 and Cloudflare mock mode from Task 4.
- Produces: installable offline shell, hardened Pages responses, repeatable browser acceptance, and operator documentation.

- [ ] **Step 1: Write failing online/update tests and Playwright journey**

```tsx
it("reports offline state", () => {
  setNavigatorOnline(false);
  const { result } = renderHook(() => useOnlineStatus());
  expect(result.current).toEqual({ isOnline: false });
});
```

```ts
// e2e/yachiyo-chat.spec.ts
import { expect, test } from "@playwright/test";

test("matches the mobile chat composition and streams a mock reply", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("访问码").fill("yachiyo-local-access");
  await page.getByRole("button", { name: "进入" }).click();
  await page.getByPlaceholder("什么都可以告诉我").fill("今天有点累");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/彩叶/)).toBeVisible();
  await expect(page).toHaveScreenshot("yachiyo-mobile-390x844.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
});
```

- [ ] **Step 2: Run focused tests and confirm red**

Run: `npm run test:unit -- src/pwa`

Expected: FAIL because offline/update modules do not exist.

- [ ] **Step 3: Implement offline and update behavior**

`useOnlineStatus` must subscribe to `online`/`offline`, expose `isOnline`, and clean up listeners. App must keep IndexedDB history readable while offline, disable send/capture, and restore them without reload. `UpdatePrompt` must use `virtual:pwa-register/react`, announce offline readiness, and require explicit confirmation before calling `updateServiceWorker(true)`.

Ensure Workbox precaches only the app shell and static assets. Add runtime rules that reject caching for `/api/`, request method other than GET, and any response with `cache-control: no-store`.

- [ ] **Step 4: Add Cloudflare headers and SPA routing**

`public/_headers` must set:

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

`public/_redirects` must contain `/* /index.html 200`. Pages Functions routes remain authoritative for `/api/*`.

- [ ] **Step 5: Configure and run browser acceptance**

Configure Playwright with a 390 × 844 Chromium project and a 1440 × 1000 desktop project. Its web server command must build and start `wrangler pages dev` with local KV plus safe mock bindings; no real StepFun key is present. Seed deterministic stars for screenshots via a test-only query parameter ignored in production state.

Run: `npm run test:e2e`

On the first screenshot run, Playwright creates the missing 390 × 844 baseline and reports the snapshot as new. Inspect that image against the supplied UI, accept it only after visual alignment, then rerun. Expected on the second run: access gate, mock stream, stop, locale switch, image input, offline read-only, keyboard navigation, 390px screenshot, and desktop centered-column tests pass with no console errors.

Then run one manual real-browser pass at 320, 375, 430, 768, 1024, and 1440 pixels and compare the 390 × 844 capture to the supplied UI image. Adjust only CSS/layout tokens; do not change product behavior during visual tuning.

- [ ] **Step 6: Write deployment and secret-rotation documentation**

README must include:

1. Node/npm prerequisites and all verification commands.
2. Local mock command and local access code used only by mock mode.
3. How to hash a random 16+ character access code without committing it.
4. Cloudflare Pages Git build command `npm run build` and output directory `dist`.
5. Dashboard KV binding `RATE_LIMIT_KV`.
6. Secrets `STEPFUN_API_KEY`, `ACCESS_CODE_SHA256`, `SESSION_SIGNING_SECRET`.
7. Variables `STEPFUN_BASE_URL`, `STEPFUN_MODEL`, `DAILY_REQUEST_LIMIT`, `AUTH_ATTEMPT_LIMIT`, with `APP_MODE` absent or `live` in production.
8. A mandatory warning to revoke the key previously pasted into chat and deploy only a new key.
9. A post-deploy smoke checklist for auth, chat, capture, locale, quota, offline history, and secret scanning.

- [ ] **Step 7: Run the full verification matrix**

Run: `npm run test`

Expected: client and workerd suites pass.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run lint`

Expected: exit 0.

Run: `npm run build`

Expected: production build succeeds.

Run: `npm run test:e2e`

Expected: all Chromium projects pass with no console errors.

Run: `rg -n "STEPFUN_API_KEY=.+|Authorization: Bearer [A-Za-z0-9]|3JUG" . -g '!node_modules' -g '!dist' -g '!.git'`

Expected: no matches. Do not place the full previously exposed key into this command or any file.

- [ ] **Step 8: Commit the release-ready slice**

```bash
git add public src/pwa vite.config.ts package.json package-lock.json playwright.config.ts e2e README.md
git commit -m "feat: finish offline PWA and browser verification"
```

---

## Final Review Gate

After Task 9, perform two fresh-context reviews before declaring completion:

1. Requirements review against every acceptance criterion in `docs/superpowers/specs/2026-07-11-yachiyo-chat-design.md`.
2. Code-quality and security review focused on API-key exposure, access-code handling, SSE parsing, Unicode bounds, image memory, IndexedDB cleanup, accessibility, and responsive fidelity.

Fix every confirmed issue with a failing regression test, rerun the full verification matrix, inspect `git status --short`, and only then prepare the completion handoff.
