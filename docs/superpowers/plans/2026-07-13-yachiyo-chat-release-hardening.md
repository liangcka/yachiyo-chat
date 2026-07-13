# Yachiyo Chat Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有功能型 RC 加固为仓库内可重复验证的上线候选：修复 SSE、会话轮换、离线门禁、图片状态、弹层焦点、移动视口、滚动与异步错误；补齐 Chromium 验收、泄密扫描、CI 和人工上线门。

**Architecture:** 保留 React/TypeScript/Vite 客户端、Dexie 本地数据、Cloudflare Pages Functions、KV 尽力限流、StepFun SSE 与 PWA 边界。服务端改动限定在会话密钥派生、响应头和流完成判定；客户端改动限定在现有 App/组件边界及少量复用 Hook；发布证据由 Vitest、Cloudflare Workers 测试、Playwright、Node 扫描脚本和 GitHub Actions 共同产生。

**Tech Stack:** Node.js 22.12.0、npm、React 19.2、TypeScript 6、Vite 8、Dexie 4、Vitest 4、Cloudflare Workers Vitest Pool、Wrangler 4、Playwright 1.61、Chromium、GitHub Actions。

## Global Constraints

- 产品契约是 docs/superpowers/specs/2026-07-13-yachiyo-chat-release-hardening-design.md；实现不得扩大到账号、语音、云历史、严格额度或 UI 重设计。
- 保留深蓝星空、磨砂玻璃、桌面最大 430px 主构图；只改布局 bug、交互、状态、错误反馈和可访问性。
- KV 是尽力防滥用计数，不得在代码或 README 中描述成严格计费边界。
- 在线时服务端 Cookie 始终权威；IndexedDB 的 deviceVerified 只决定离线时能否读取本地壳层，不具备鉴权能力。
- 在线会话失效不得清掉 deviceVerified；只有显式退出清除它。“清除本地数据”保留语言和 deviceVerified。
- 不写入、打印、提交或上传任何真实 StepFun Key、访问码、访问码摘要、会话签名密钥或旧 Key 完整值。
- 角色提示词只允许存在于根 角色提示词.txt 和生成的 Functions 服务端输入；dist 不得包含其可识别片段。
- 每项行为修改都遵循 RED → 最小 GREEN → focused verification → 原子提交。
- 本机 Windows 中文物理路径可能使 Cloudflare Workers 测试池在测试启动前失败；遇到该已知错误时记录结果，并以纯 ASCII 克隆或 Linux CI 的同一命令为权威，不把环境失败误报成测试 RED。
- 在任务间先运行 git status --short；不得覆盖用户已有改动。
- 本计划必须在开始 Task 1 前提交到 `feature/yachiyo-chat`；后续 PR 链接的就是这份已跟踪文件，Task 14 只追加真实 Verification record。

## Official Sources Locked for This Plan

- Playwright 快照模板与 token：https://playwright.dev/docs/api/class-testconfig#test-config-snapshot-path-template
- Playwright 视觉比较：https://playwright.dev/docs/test-snapshots
- Playwright CI 与单 worker 建议：https://playwright.dev/docs/ci
- Chromium 单浏览器安装：https://playwright.dev/docs/browsers
- GitHub Node 工作流：https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs
- actions/checkout v6.0.2：https://github.com/actions/checkout/releases/tag/v6.0.2
- actions/setup-node v6.4.0：https://github.com/actions/setup-node/releases/tag/v6.4.0
- actions/upload-artifact v7.0.1：https://github.com/actions/upload-artifact/releases/tag/v7.0.1
- Gitleaks Action v3.0.0：https://github.com/gitleaks/gitleaks-action/releases/tag/v3.0.0
- Gitleaks CLI v8.30.1：https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1
- VisualViewport 事件与度量：https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- viewport interactive-widget：https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport
- Web Crypto HMAC：https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign
- StepFun 开放平台隐私政策：https://platform.stepfun.com/legal/privacy-policy.html

---

### Task 1: Correct provider completion and the 200/201 Unicode boundary

**Files:**
- Modify: functions-tests/_shared/stream.test.ts
- Modify: functions/_shared/stream.ts

**Contract:**
- 只有读取到精确 data: [DONE] 才能成功结束。
- 上游在 [DONE] 前 EOF 时发一个稳定 PROVIDER_STREAM_ERROR，不能发 done。
- 恰好 200 个 Unicode code point 后继续等 [DONE]；观察到第 201 个才截断并取消上游。

- [ ] **Step 1: Add an upstream helper that omits [DONE]**

在 functions-tests/_shared/stream.test.ts 的 upstreamSse 后加入：

~~~ts
function upstreamWithoutDone(deltas: string[], chunkSize = 7): Response {
  const records = deltas
    .map(
      (content) =>
        "data: " +
        JSON.stringify({ choices: [{ delta: { content } }] }) +
        "\r\n\r\n",
    )
    .join("");
  return chunkedResponse(records, chunkSize);
}
~~~

- [ ] **Step 2: Write the three boundary regressions**

~~~ts
it("emits an error when the provider closes after deltas without [DONE]", async () => {
  const response = proxyStepFunStream(upstreamWithoutDone(["partial"]));

  await expect(collectClientEvents(response.body!)).resolves.toEqual([
    { type: "delta", text: "partial" },
    { type: "error", code: "PROVIDER_STREAM_ERROR" },
  ]);
});

it("accepts exactly 200 Unicode characters when followed by [DONE]", async () => {
  const abort = vi.fn();
  const response = proxyStepFunStream(upstreamSse(["八".repeat(200)]), { abort });
  const events = await collectClientEvents(response.body!);
  const text = events
    .filter((event) => event.type === "delta")
    .map((event) => event.text)
    .join("");

  expect([...text]).toHaveLength(200);
  expect(events.at(-1)).toEqual({ type: "done", truncated: false });
  expect(abort).not.toHaveBeenCalled();
});

it("truncates at the 201st Unicode character", async () => {
  const abort = vi.fn();
  const response = proxyStepFunStream(upstreamSse(["八".repeat(201)]), { abort });
  const events = await collectClientEvents(response.body!);
  const text = events
    .filter((event) => event.type === "delta")
    .map((event) => event.text)
    .join("");

  expect([...text]).toHaveLength(200);
  expect(events.at(-1)).toEqual({ type: "done", truncated: true });
  expect(abort).toHaveBeenCalledOnce();
});
~~~

- [ ] **Step 3: Confirm RED**

Run: npm run test:functions -- functions-tests/_shared/stream.test.ts

Expected on an ASCII path/Linux: the missing-DONE test receives done instead of error, and the exact-200 test receives truncated true. On the current Chinese path, only the documented Cloudflare pool startup error is an environment result.

- [ ] **Step 4: Track provider completion explicitly**

在 proxyStepFunStream 的 start closure 中加入 sawProviderDone，并只在 [DONE] 分支置真：

~~~ts
let buffer = "";
let emittedCharacters = 0;
let sawProviderDone = false;

const handleData = async (data: string): Promise<boolean> => {
  if (data === "[DONE]") {
    sawProviderDone = true;
    finish(false);
    return false;
  }
  // existing delta parsing
};
~~~

EOF 分支替换为：

~~~ts
if (done) {
  buffer += decoder.decode();
  if (!(await consumeRecords(true))) return;
  if (sawProviderDone) finish(false);
  else await fail();
  return;
}
~~~

将截断条件从 accepted.hasMore || accepted.characters === remaining 改为：

~~~ts
if (accepted.hasMore) {
  abortUpstream();
  try {
    await reader.cancel();
  } catch {
    // The response limit has already determined the client result.
  }
  finish(true);
  return false;
}
~~~

- [ ] **Step 5: Confirm GREEN and commit**

Run: npm run test:functions -- functions-tests/_shared/stream.test.ts

Expected: all stream tests pass on ASCII/Linux; exact-200 is not truncated, 201 is truncated, missing [DONE] ends with one stable error.

Run: git diff --check

Commit:

~~~powershell
git add functions/_shared/stream.ts functions-tests/_shared/stream.test.ts
git commit -m "fix: enforce provider stream completion"
~~~

---

### Task 2: Invalidate all old sessions when either authentication secret rotates

**Files:**
- Modify: functions-tests/api/session.test.ts
- Modify: functions-tests/api/chat.test.ts
- Modify: functions/_shared/session.ts
- Modify: functions/api/session.ts
- Modify: functions/api/chat.ts

**Contract:**
- 有效签名材料由 SESSION_SIGNING_SECRET 和规范化 ACCESS_CODE_SHA256 通过域分离 HMAC 派生。
- Cookie payload 不增加摘要。
- mock 模式无需 live secrets 仍可工作。

- [ ] **Step 1: Make chat tests sign with the resolved key**

修改 import，并替换 chatRequest 中的原始 secret：

~~~ts
import {
  resolveSessionSigningSecret,
  sessionCookie,
  signSession,
} from "../../functions/_shared/session";

const signingSecret = await resolveSessionSigningSecret(runtimeEnv);
if (signingSecret === null) throw new TypeError("Missing test signing secret");
const token = await signSession(
  { sid: sessionId, exp: Date.now() + 60_000 },
  signingSecret,
);
~~~

- [ ] **Step 2: Add both-secret rotation regressions**

在 session.test.ts 用 `it.each` 覆盖两种独立轮换：先 POST 登录取得 cookie，再分别用仅 `ACCESS_CODE_SHA256` 不同、仅 `SESSION_SIGNING_SECRET` 不同的 `rotatedEnv` 调 `onRequestGet`，两者都期望 `{ authenticated: false }`。合法替换摘要使用 `"0".repeat(64)`；替换 signing secret 使用另一个至少 32 字符的 test-only 值。

在 chat.test.ts 把轮换回归参数化为同样两种环境变体：

~~~ts
it.each([
  {
    name: "ACCESS_CODE_SHA256",
    rotate: (current: Env): Env => ({
      ...current,
      ACCESS_CODE_SHA256: "0".repeat(64),
    }),
  },
  {
    name: "SESSION_SIGNING_SECRET",
    rotate: (current: Env): Env => ({
      ...current,
      SESSION_SIGNING_SECRET: "rotated-test-only-signing-secret-32-plus",
    }),
  },
])("rejects a chat cookie issued before $name rotation", async ({ rotate }) => {
  const request = await chatRequest(
    { locale: "zh-CN", messages: [{ role: "user", text: "你好" }] },
    "rotated-session",
  );

  const response = await invoke(request, rotate(env));

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: { code: "SESSION_REQUIRED" } });
  expect(providerFetch).not.toHaveBeenCalled();
});
~~~

再加 mock 回归：APP_MODE 为 mock、ACCESS_CODE_SHA256 和 SESSION_SIGNING_SECRET 为空时，POST 固定 mock 访问码后 GET 仍 authenticated true。

- [ ] **Step 3: Confirm RED**

Run: npm run test:functions -- functions-tests/api/session.test.ts functions-tests/api/chat.test.ts

Expected on ASCII/Linux: rotation tests fail because current resolver只返回 SESSION_SIGNING_SECRET；mock 特征测试可保持 GREEN。

- [ ] **Step 4: Make the resolver async and derive a domain-separated key**

在 functions/_shared/session.ts 保留 signSession/verifySession/sessionFromRequest 签名不变，替换 resolver：

~~~ts
function normalizeAccessCodeDigest(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/iu.test(value)) return null;
  return value.toLowerCase();
}

export async function resolveSessionSigningSecret(
  env: Pick<Env, "ACCESS_CODE_SHA256" | "APP_MODE" | "SESSION_SIGNING_SECRET">,
): Promise<string | null> {
  const baseSecret =
    env.APP_MODE === "mock"
      ? env.SESSION_SIGNING_SECRET || mockSigningSecret
      : typeof env.SESSION_SIGNING_SECRET === "string" &&
          env.SESSION_SIGNING_SECRET.length >= 32
        ? env.SESSION_SIGNING_SECRET
        : null;
  if (baseSecret === null) return null;

  const digest =
    env.APP_MODE === "mock"
      ? normalizeAccessCodeDigest(env.ACCESS_CODE_SHA256) ?? "mock-access-code-binding"
      : normalizeAccessCodeDigest(env.ACCESS_CODE_SHA256);
  if (digest === null) return null;

  return base64UrlEncode(
    await hmacSha256(baseSecret, "yachiyo-session-key:v1:" + digest),
  );
}
~~~

在 functions/api/session.ts 的 POST/GET 和 functions/api/chat.ts 调用点全部增加 await：

~~~ts
const signingSecret = await resolveSessionSigningSecret(context.env);
~~~

- [ ] **Step 5: Confirm GREEN, type safety, and commit**

Run: npm run test:functions -- functions-tests/api/session.test.ts functions-tests/api/chat.test.ts

Expected: all selected tests pass on ASCII/Linux and providerFetch is not called for rotated cookies.

Run: npm run typecheck

Expected: exit 0; no Promise<string | null> is passed to signSession/sessionFromRequest.

Commit:

~~~powershell
git add functions/_shared/session.ts functions/api/session.ts functions/api/chat.ts functions-tests/api/session.test.ts functions-tests/api/chat.test.ts
git commit -m "fix: bind sessions to auth-secret rotation"
~~~

---

### Task 3: Apply no-store and nosniff to every dynamic response

**Files:**
- Create: functions-tests/_shared/http.test.ts
- Modify: functions-tests/api/session.test.ts
- Modify: functions-tests/api/chat.test.ts
- Modify: functions/_shared/http.ts
- Modify: functions/_shared/stream.ts

- [ ] **Step 1: Add direct helper tests and a complete handler-path matrix**

先在 `functions-tests/_shared/http.test.ts` 直接覆盖 `jsonResponse`、`problemResponse`、`noContentResponse`，证明三种响应工厂都会设置两项 header。然后抽取 `expectDynamicHeaders(response)`，给当前每类 handler exit 至少一个用例：

- session GET：200、503；
- session POST：204、400、403、429、503；
- session DELETE：204、403；
- chat POST：SSE 200，以及 JSON 400、401、403、429、502、503、504。

同一状态的重复错误分支无需逐个复制，但 live/mock 两种 SSE 都必须覆盖。这样共享 helper 的直接测试负责完整构造契约，handler 矩阵负责证明每个方法与每种当前响应状态都经过该契约。

~~~ts
expect(response.headers.get("cache-control")).toBe("no-store");
expect(response.headers.get("x-content-type-options")).toBe("nosniff");
~~~

- [ ] **Step 2: Confirm RED**

Run: npm run test:functions -- functions-tests/api/session.test.ts functions-tests/api/chat.test.ts

Expected on ASCII/Linux: 三个 helper direct tests 与所有新增 nosniff 断言失败；既有 no-store 断言保持通过。

- [ ] **Step 3: Export and reuse the single header helper**

~~~ts
// functions/_shared/http.ts
export function noStoreHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}
~~~

~~~ts
// functions/_shared/stream.ts
import { noStoreHeaders } from "./http";

function streamHeaders(): Headers {
  return noStoreHeaders({
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
}
~~~

- [ ] **Step 4: Verify all focused Functions tests and commit**

Run: npm run test:functions -- functions-tests/_shared/http.test.ts functions-tests/api/session.test.ts functions-tests/api/chat.test.ts functions-tests/_shared/stream.test.ts

Expected: all selected tests pass on ASCII/Linux; JSON, 204, live SSE and mock SSE all return no-store and nosniff.

Commit:

~~~powershell
git add functions/_shared/http.ts functions/_shared/stream.ts functions-tests/_shared/http.test.ts functions-tests/api/session.test.ts functions-tests/api/chat.test.ts
git commit -m "fix: harden dynamic response headers"
~~~

---

### Task 4: Gate first-time offline use with a non-secret device marker

**Files:**
- Modify: src/data/db.ts
- Modify: src/data/conversation-repository.ts
- Modify: src/data/conversation-repository.test.ts
- Modify: src/App.tsx
- Modify: src/components/AccessGate.tsx
- Modify: src/components/app-flows.test.tsx
- Modify: src/i18n/messages.ts
- Modify: src/i18n/messages.test.ts
- Modify: src/styles/chat.css

**Contract:**
- deviceVerified 默认为 false；在线成功会话检查或访问码认证后为 true。
- 在线 session.check 返回 false 只显示门禁，不清 marker。
- 仅显式退出清 marker；网络异常不清 marker。
- 离线且 marker=true 可读历史；离线且 marker=false 只能看到禁用门禁。
- clearAll 删除 conversations/messages/images，但保留 locale 和 deviceVerified。

- [ ] **Step 1: Write repository RED tests**

把现有 clearAll 用例改名为 preserves settings while clearing chat data，并加入 marker 测试：

~~~ts
it("defaults device verification to false and persists changes", async () => {
  expect(await repository.getDeviceVerified()).toBe(false);
  await repository.setDeviceVerified(true);
  expect(await repository.getDeviceVerified()).toBe(true);
});

it("preserves locale and device verification while clearing chat data", async () => {
  const conversation = await repository.createConversation("zh-CN", 10);
  await repository.putMessage({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    role: "user",
    text: "你好",
    status: "complete",
    createdAt: 20,
  });
  await repository.setLocale("ja-JP");
  await repository.setDeviceVerified(true);

  await repository.clearAll();

  expect(await repository.listConversations()).toEqual([]);
  expect(await repository.listMessages(conversation.id)).toEqual([]);
  expect(await repository.getLocale()).toBe("ja-JP");
  expect(await repository.getDeviceVerified()).toBe(true);
});
~~~

- [ ] **Step 2: Write App flow RED tests**

在 MemoryRepository 加 deviceVerified=false、getDeviceVerified 和 setDeviceVerified；其 clearAll 不再重置 locale/marker。新增：

- requires an online verification on a never-verified offline device；
- opens persisted history offline on a previously verified device；
- marks the device after a successful session check；
- marks the device after access-code authentication；
- keeps the marker when an online session is expired；
- clears the marker only after explicit sign-out；
- preserves locale and marker after clear local data。

首次离线的关键断言：

~~~tsx
const repository = new MemoryRepository();
Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
render(<App services={fakeServices({ repository })} />);

expect(await screen.findByText("首次使用需要联网验证。")).toBeVisible();
expect(screen.getByLabelText("访问码")).toBeDisabled();
expect(screen.getByRole("button", { name: "进入" })).toBeDisabled();
expect(screen.queryByPlaceholderText("什么都可以告诉我")).not.toBeInTheDocument();
~~~

已验证离线用例必须先设置 repository.deviceVerified = true，再断言 composer/拍摄禁用而历史可读。

- [ ] **Step 3: Confirm RED**

Run: npm run test:unit -- src/data/conversation-repository.test.ts src/components/app-flows.test.tsx src/i18n/messages.test.ts

Expected: marker 方法/文案不存在，clearAll 重置 settings，离线会无条件绕过门禁。

- [ ] **Step 4: Add the typed setting without a Dexie migration**

~~~ts
// src/data/db.ts
export type AppSetting =
  | { key: "locale"; value: Locale }
  | { key: "deviceVerified"; value: boolean };
~~~

settings 的 key 索引不变，不升级数据库版本。仓储增加：

~~~ts
async getLocale(): Promise<Locale> {
  const setting = await this.db.settings.get("locale");
  return setting?.key === "locale" ? setting.value : "zh-CN";
}

async getDeviceVerified(): Promise<boolean> {
  const setting = await this.db.settings.get("deviceVerified");
  return setting?.key === "deviceVerified" ? setting.value : false;
}

async setDeviceVerified(verified: boolean): Promise<void> {
  await this.db.settings.put({ key: "deviceVerified", value: verified });
}

async clearAll(): Promise<void> {
  await this.db.transaction(
    "rw",
    [this.db.conversations, this.db.messages, this.db.images],
    async () => {
      await Promise.all([
        this.db.conversations.clear(),
        this.db.messages.clear(),
        this.db.images.clear(),
      ]);
    },
  );
}
~~~

AppRepository 同步增加 getDeviceVerified(): Promise<boolean> 和 setDeviceVerified(verified: boolean): Promise<void>。

- [ ] **Step 5: Make online/offline authentication authoritative in the right place**

App 的 authentication 初始值统一为 checking。在现有 `showSessionFailure` 旁增加 Effect Event，避免把 locale copy 闭包塞进认证 effect 依赖：

~~~ts
const showStorageFailure = useEffectEvent(() =>
  showToast(copy.storageFull, "error"),
);
~~~

认证 effect 的最小状态机：

~~~ts
if (!isOnline) {
  let cancelled = false;
  void activeServices.repository
    .getDeviceVerified()
    .then((verified) => {
      if (!cancelled) setAuthentication(verified ? "authenticated" : "unauthenticated");
    })
    .catch(() => {
      if (!cancelled) {
        setAuthentication("unauthenticated");
        showSessionFailure();
      }
    });
  return () => {
    cancelled = true;
  };
}

const abortController = new AbortController();
let cancelled = false;
void activeServices.session
  .check(abortController.signal)
  .then((authenticated) => {
    if (cancelled) return;
    setAuthentication(authenticated ? "authenticated" : "unauthenticated");
    if (authenticated) {
      void activeServices.repository
        .setDeviceVerified(true)
        .catch(() => {
          if (!cancelled) showStorageFailure();
        });
    }
  })
  .catch(() => {
    if (!cancelled) {
      setAuthentication("unauthenticated");
      showSessionFailure();
    }
  });
~~~

保留现有 AbortController cleanup，effect 依赖精确为 `[activeServices, isOnline]`；Effect Event 不写入依赖数组。

handleAuthenticate 在 session 成功后立即切 authenticated，再捕获 setDeviceVerified(true) 的存储失败并显示 storageFull；在线服务端会话不能因为 marker 写入失败而被本地状态反向否定。handleSignOut 在 controller.stop 后清 marker、调用 session.signOut、再显示门禁；Task 10 会把失败回滚和 Toast 统一化。不要在 session.check false 或 SESSION_REQUIRED 控制器错误处清 marker。

- [ ] **Step 6: Add offline and privacy copy to AccessGate**

UiCopy 增加：

~~~ts
readonly offlineAccessRequired: string;
readonly privacyNotice: string;
readonly privacyPolicy: string;
~~~

中文：

~~~ts
offlineAccessRequired: "首次使用需要联网验证。",
privacyNotice: "发送的文字和图片会交给 StepFun 处理。",
privacyPolicy: "查看隐私政策",
~~~

日文：

~~~ts
offlineAccessRequired: "初回利用にはオンライン認証が必要です。",
privacyNotice: "送信した文章と画像はStepFunで処理されます。",
privacyPolicy: "プライバシーポリシーを見る",
~~~

AccessGateProps 增加 isOnline: boolean。离线时禁用 input/button，显示 offlineAccessRequired；门禁底部始终显示 privacyNotice 和链接：

~~~tsx
<p className="access-gate__privacy">
  {copy.privacyNotice}{" "}
  <a
    href="https://platform.stepfun.com/legal/privacy-policy.html"
    rel="noreferrer"
    target="_blank"
  >
    {copy.privacyPolicy}
  </a>
</p>
~~~

App 传入 isOnline。链接非阻断，不增加 consent 状态。

chat.css 只增加紧凑的说明样式，不改变门禁构图：

~~~css
.access-gate__privacy {
  margin: 1rem 0 0;
  color: var(--text-dim);
  font-size: 0.74rem;
  line-height: 1.45;
}

.access-gate__privacy a {
  color: var(--text-muted);
}
~~~

- [ ] **Step 7: Confirm GREEN and commit**

Run: npm run test:unit -- src/data/conversation-repository.test.ts src/components/app-flows.test.tsx src/i18n/messages.test.ts

Expected: selected tests pass；全新设备离线不能进入 chat，已验证设备离线可读，clearAll 保留两个 settings。

Run: npm run typecheck

Expected: AppServices、MemoryRepository、ConversationRepository 类型一致。

Commit:

~~~powershell
git add src/data/db.ts src/data/conversation-repository.ts src/data/conversation-repository.test.ts src/App.tsx src/components/AccessGate.tsx src/components/app-flows.test.tsx src/i18n/messages.ts src/i18n/messages.test.ts src/styles/chat.css
git commit -m "fix: require prior verification for offline access"
~~~

---

### Task 5: Make pendingImage the only image draft state

**Files:**
- Modify: src/App.tsx
- Modify: src/components/Composer.tsx
- Modify: src/components/MessageBubble.tsx
- Modify: src/components/chat-components.test.tsx
- Modify: src/components/app-flows.test.tsx
- Modify: src/i18n/messages.ts
- Modify: src/i18n/messages.test.ts

- [ ] **Step 1: Write Blob preview lifecycle tests**

在 chat-components.test.tsx stub URL.createObjectURL/revokeObjectURL，测试：

- pendingImage 存在时，即使 value 为空也立即启用发送；
- 预览 img 使用本地化名称；
- Blob 替换、移除或卸载时 revoke 对应 URL；
- 历史消息图片也有本地化可访问名称。

核心用例：

~~~tsx
const blob = new Blob(["image"], { type: "image/jpeg" });
const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
const { unmount } = render(
  <Composer
    copy={copyFor("zh-CN")}
    onChange={vi.fn()}
    onRemoveImage={vi.fn()}
    onSend={vi.fn()}
    onStop={vi.fn()}
    pendingImage={{ blob }}
    phase="idle"
    value=""
  />,
);

expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
expect(await screen.findByRole("img", { name: "待发送图片预览" })).toHaveAttribute(
  "src",
  "blob:preview",
);
unmount();
expect(createObjectURL).toHaveBeenCalledWith(blob);
expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
~~~

- [ ] **Step 2: Write App lifecycle regressions**

更新拍照测试通过 container.querySelector('input[type="file"]') 取得隐藏 input。新增拍图后切换历史、新建对话、删除当前对话，均断言“移除图片”消失；成功发送后也消失。不要检查 App 内 data URL state，因为该 state 将被删除。

- [ ] **Step 3: Confirm RED**

Run: npm run test:unit -- src/components/chat-components.test.tsx src/components/app-flows.test.tsx src/i18n/messages.test.ts

Expected: Composer 不接受 pendingImage，App 切换会话后仍可能保留 pendingImageDataUrl，图片 alt 为空。

- [ ] **Step 4: Derive preview URL from the controller Blob**

ComposerProps 替换为：

~~~ts
pendingImage?: Pick<StoredImage, "blob">;
onRemoveImage?: () => void;
~~~

用一个只负责 DOM URL 生命周期的内部组件，避免在 render 中制造 object URL，也避免 effect 内同步 setState：

~~~ts
function BlobPreview({ alt, blob }: { alt: string; blob: Blob }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(blob);
    const image = imageRef.current;
    if (image !== null) image.src = url;
    return () => {
      if (image?.getAttribute("src") === url) image.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  return <img ref={imageRef} alt={alt} />;
}
~~~

canSend 使用 pendingImage !== undefined；预览使用 BlobPreview。App 删除 pendingImageDataUrl state 及全部 set 调用，只传：

~~~tsx
pendingImage={controller.pendingImage}
onRemoveImage={() => controller.setPendingImage(undefined)}
~~~

ProcessedImage.dataUrl 暂不改契约；它仍可用于既有处理/测试，但不再作为 UI state。

- [ ] **Step 5: Localize image accessible names**

UiCopy 加：

~~~ts
readonly pendingImagePreview: string;
readonly imageAttachment: string;
~~~

值：

~~~ts
// zh-CN
pendingImagePreview: "待发送图片预览",
imageAttachment: "图片附件",

// ja-JP
pendingImagePreview: "送信前の画像プレビュー",
imageAttachment: "画像の添付",
~~~

Composer 使用 alt={copy.pendingImagePreview}。MessageBubble 用 copyFor(locale).imageAttachment，不改变现有 article label。

- [ ] **Step 6: Confirm GREEN and commit**

Run: npm run test:unit -- src/components/chat-components.test.tsx src/components/app-flows.test.tsx src/i18n/messages.test.ts

Expected: focused suite passes；object URLs 都被回收，切换/新建/删除/发送不留幽灵预览。

Run: npm run lint

Expected: exit 0；object URL 只在 effect 中创建/释放，effect 不同步 setState。

Commit:

~~~powershell
git add src/App.tsx src/components/Composer.tsx src/components/MessageBubble.tsx src/components/chat-components.test.tsx src/components/app-flows.test.tsx src/i18n/messages.ts src/i18n/messages.test.ts
git commit -m "fix: unify pending image state"
~~~

---

### Task 6: Share modal focus management and isolate the background

**Files:**
- Create: src/components/use-modal-focus.ts
- Create: src/components/use-modal-focus.test.tsx
- Modify: src/components/MenuDrawer.tsx
- Modify: src/components/HistoryPanel.tsx
- Modify: src/components/TopControls.tsx
- Modify: src/components/ConversationView.tsx
- Modify: src/components/ToastRegion.tsx
- Modify: src/pwa/UpdatePrompt.tsx
- Modify: src/components/app-flows.test.tsx
- Modify: src/App.tsx

- [ ] **Step 1: Write hook behavior tests**

用一个 Harness 渲染触发按钮和 open dialog，逐项测试：

- 打开后初始控件获得焦点；
- Tab 从最后一个回到第一个；
- Shift+Tab 从第一个回到最后一个；
- Escape 调 onClose；
- 关闭/卸载后焦点回到打开前的按钮。

Hook 公共签名固定为：

~~~ts
export interface ModalFocusOptions<T extends HTMLElement> {
  containerRef: RefObject<T | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose(): void;
}

export function useModalFocus<T extends HTMLElement>(
  options: ModalFocusOptions<T>,
): KeyboardEventHandler<T>;
~~~

- [ ] **Step 2: Add the App flow RED test**

从顶栏菜单按钮打开菜单，再打开历史；断言历史关闭按钮聚焦。模拟 Tab/Shift+Tab 不离开 history dialog；点击现有 `.overlay--history` 空白区域可关闭、点击 panel 内部不会误关；Escape 后 dialog 消失并把焦点还给顶栏菜单按钮。

再让 `virtual:pwa-register/react` mock 显示 offline-ready `UpdatePrompt`，打开任一弹层后断言现有非弹层根节点 `.top-controls`、`.conversation-view`、`.chat-bottom`、`.toast-region`、`.pwa-prompt` 都有 `inert`，而当前 dialog 没有；关闭后这些属性全部移除。真实 Chromium E2E 在 Task 12 复验 PWA prompt 可见时，Tab 与指针都不能激活 prompt 按钮。

- [ ] **Step 3: Confirm RED**

Run: npm run test:unit -- src/components/use-modal-focus.test.tsx src/components/app-flows.test.tsx

Expected: hook 文件不存在，HistoryPanel 无 Escape/trap/return focus，现有非弹层根节点没有 inert。

- [ ] **Step 4: Implement the shared hook with a latest-callback ref**

不要把 React useEffectEvent 返回值传给 DOM handler。使用 ref 保存最新 onClose：

~~~ts
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function useModalFocus<T extends HTMLElement>({
  containerRef,
  initialFocusRef,
  onClose,
  open,
}: ModalFocusOptions<T>): KeyboardEventHandler<T> {
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [containerRef, initialFocusRef, open]);

  return (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
}
~~~

- [ ] **Step 5: Apply it without changing the existing DOM hierarchy**

MenuDrawer 删除重复 focus/key logic，调用 useModalFocus。HistoryPanel 只给现有 section 增加 ref/共享 handler，并在现有 `.overlay--history` 节点上处理遮罩点击：仅当 `event.target === event.currentTarget` 时关闭。不要新增 backdrop 节点；MenuDrawer 保留它原本已有的 backdrop button。这样 Escape/遮罩行为补齐，但现有 DOM 层级不变。

不要增加 wrapper。给 `TopControls`、`ConversationView`、`ToastRegion`、`UpdatePrompt` 增加可选的 `inert?: boolean` prop，并把它原样放到各自现有根元素；`.chat-bottom` 直接接收同一值：

~~~tsx
const modalOpen = menuOpen || historyOpen;

<TopControls inert={modalOpen || undefined} {...existingProps} />
<ConversationView inert={modalOpen || undefined} {...existingProps} />
<div className="chat-bottom" inert={modalOpen || undefined}>
  {/* existing bottom controls */}
</div>
<ToastRegion inert={modalOpen || undefined} {...existingProps} />
<UpdatePrompt inert={modalOpen || undefined} {...existingProps} />
~~~

MenuDrawer/HistoryPanel 的位置、现有 class 和视觉样式保持不变。`inert` 覆盖所有可交互兄弟节点，包括 z-index 高于 overlay 的 PWA prompt；不要用 `aria-hidden` 代替 inert，也不要新增 `.chat-content`。

- [ ] **Step 6: Verify focus, type safety, and commit**

Run: npm run test:unit -- src/components/use-modal-focus.test.tsx src/components/app-flows.test.tsx

Expected: focused suite passes；初始焦点、双向圈定、Escape、遮罩和返回焦点都有覆盖。

Run: npm run typecheck

Expected: React 19 inert 属性和 RefObject 泛型通过。

Commit:

~~~powershell
git add src/components/use-modal-focus.ts src/components/use-modal-focus.test.tsx src/components/MenuDrawer.tsx src/components/HistoryPanel.tsx src/components/TopControls.tsx src/components/ConversationView.tsx src/components/ToastRegion.tsx src/pwa/UpdatePrompt.tsx src/components/app-flows.test.tsx src/App.tsx
git commit -m "fix: contain focus inside chat overlays"
~~~

---

### Task 7: Keep the composer inside the visual viewport

**Files:**
- Create: src/app/use-visual-viewport.ts
- Create: src/app/use-visual-viewport.test.tsx
- Modify: src/App.tsx
- Modify: src/styles/chat.css
- Modify: index.html

- [ ] **Step 1: Write hook RED tests**

测试初值、visualViewport resize、visualViewport scroll/offsetTop、window resize fallback 和卸载清理。测试中用 EventTarget 伪造 visualViewport，并用 Object.defineProperty(window, "visualViewport", ...) 安装/还原。

固定接口：

~~~ts
export interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
}

export function useVisualViewportMetrics(): VisualViewportMetrics;
~~~

关键断言：

~~~tsx
const { result, unmount } = renderHook(() => useVisualViewportMetrics());
expect(result.current).toEqual({ height: 640, offsetTop: 12 });

act(() => {
  viewport.height = 420;
  viewport.offsetTop = 28;
  viewport.dispatchEvent(new Event("resize"));
  vi.runAllTimers();
});
expect(result.current).toEqual({ height: 420, offsetTop: 28 });
unmount();
expect(viewport.listenerCount("resize")).toBe(0);
expect(viewport.listenerCount("scroll")).toBe(0);
~~~

- [ ] **Step 2: Confirm RED**

Run: npm run test:unit -- src/app/use-visual-viewport.test.tsx

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement coalesced metrics and cleanup**

~~~ts
import { useEffect, useState } from "react";

export interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
}

function readMetrics(): VisualViewportMetrics {
  const viewport = window.visualViewport;
  return {
    height: viewport?.height ?? window.innerHeight,
    offsetTop: viewport?.offsetTop ?? 0,
  };
}

export function useVisualViewportMetrics(): VisualViewportMetrics {
  const [metrics, setMetrics] = useState(readMetrics);

  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMetrics(readMetrics()));
    };
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return metrics;
}
~~~

- [ ] **Step 4: Wire CSS variables and viewport policy**

App：

~~~tsx
const { height: visibleHeight, offsetTop: visibleTop } = useVisualViewportMetrics();
const chatStageStyle: CSSProperties & {
  "--chat-visible-height": string;
  "--chat-visible-top": string;
} = {
  "--chat-visible-height": visibleHeight + "px",
  "--chat-visible-top": visibleTop + "px",
};

<div className="chat-stage" style={chatStageStyle}>
~~~

chat.css：

~~~css
.chat-stage {
  height: var(--chat-visible-height, 100dvh);
  min-height: 0;
  margin-block-start: var(--chat-visible-top, 0);
}
~~~

删除原 min-height: 35rem，不改宽度/max-width/星空/玻璃样式。index.html 的 viewport content 追加 interactive-widget=resizes-content，保留 viewport-fit=cover 和用户缩放。

- [ ] **Step 5: Verify and commit**

Run: npm run test:unit -- src/app/use-visual-viewport.test.tsx src/components/app-flows.test.tsx

Expected: all selected tests pass；事件和 RAF 在卸载时清理。

Run: npm run typecheck

Expected: exit 0。

Commit:

~~~powershell
git add src/app/use-visual-viewport.ts src/app/use-visual-viewport.test.tsx src/App.tsx src/styles/chat.css index.html
git commit -m "fix: follow the mobile visual viewport"
~~~

---

### Task 8: Stop streaming deltas from stealing the reader's scroll position

**Files:**
- Modify: src/components/ConversationView.tsx
- Modify: src/components/chat-components.test.tsx
- Modify: src/App.tsx

- [ ] **Step 1: Write behavioral RED tests**

在 chat-components.test.tsx 构造可变 messages Harness，并 stub end.scrollIntoView。用 Object.defineProperties 设置 conversation-view 的 scrollHeight、scrollTop、clientHeight。覆盖：

- 初次加载和新 message id 会滚到底；
- 同一个 assistant id 追加 text 时，用户距底部超过 80px 不滚；
- 用户重新滚到距底部 80px 内后，下一个 delta 恢复滚动；
- prefers-reduced-motion 为 true 时 behavior 为 auto，否则 smooth。

判断函数固定为：

~~~ts
function isNearBottom(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = 80,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}
~~~

- [ ] **Step 2: Confirm RED**

Run: npm run test:unit -- src/components/chat-components.test.tsx

Expected: current ConversationView 在每个 messages 数组变化时都 smooth scroll，包括用户已上滚的流式 delta。

- [ ] **Step 3: Track follow state and message identity**

ConversationView 增加 sectionRef、previousMessagesRef、followingRef。section onScroll 更新 followingRef。effect 按 id/长度区分新消息与同一条 delta：

~~~ts
const previous = previousMessagesRef.current;
const previousLast = previous.at(-1);
const currentLast = messages.at(-1);
const isInitial = previous.length === 0;
const isNewMessage =
  currentLast !== undefined &&
  (messages.length > previous.length || currentLast.id !== previousLast?.id);
const isStreamingDelta =
  currentLast !== undefined &&
  previousLast !== undefined &&
  currentLast.id === previousLast.id &&
  currentLast.text !== previousLast.text;

if (isInitial || isNewMessage || (isStreamingDelta && followingRef.current)) {
  endRef.current?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "end",
  });
}
previousMessagesRef.current = messages;
~~~

不要根据数组引用本身决定滚动。onScroll：

~~~tsx
<section
  className="conversation-view"
  onScroll={(event) => {
    followingRef.current = isNearBottom(event.currentTarget);
  }}
  ref={sectionRef}
>
~~~

App 给 ConversationView 增加 key={controller.activeConversation?.id}，切换会话后重置跟随状态。

- [ ] **Step 4: Verify and commit**

Run: npm run test:unit -- src/components/chat-components.test.tsx src/components/app-flows.test.tsx

Expected: selected tests pass；远离底部时 delta 不滚，新消息/回到底部时滚，reduced-motion 用 auto。

Commit:

~~~powershell
git add src/components/ConversationView.tsx src/components/chat-components.test.tsx src/App.tsx
git commit -m "fix: preserve manual chat scrolling"
~~~

---

### Task 9: Close the remaining keyboard and touch-target gaps

**Files:**
- Modify: src/features/capture/CaptureButton.tsx
- Modify: src/features/capture/CaptureButton.test.tsx
- Modify: src/components/ControlDock.tsx
- Modify: src/components/chat-components.test.tsx
- Modify: src/styles/chat.css
- Modify: src/pwa/UpdatePrompt.test.tsx

- [ ] **Step 1: Add RED assertions**

CaptureButton 测试用 render 返回的 container 查询 input[type=file]，断言：

~~~ts
expect(input).toHaveAttribute("tabindex", "-1");
expect(input).toHaveAttribute("aria-hidden", "true");
~~~

ControlDock 测试对 reserved control fireEvent.focus，断言 onUnavailable 收到同一条本地化说明。

UpdatePrompt/组件测试给需要扩大的按钮加稳定 class 或 aria-label 断言，浏览器尺寸验证在 Task 12 完成。

- [ ] **Step 2: Confirm RED**

Run: npm run test:unit -- src/features/capture/CaptureButton.test.tsx src/components/chat-components.test.tsx src/pwa/UpdatePrompt.test.tsx

Expected: file input 仍是可访问的第二入口，reserved focus 不提示。

- [ ] **Step 3: Remove the hidden tab stop and support keyboard focus hints**

~~~tsx
<input
  ref={inputRef}
  accept="image/*"
  aria-hidden="true"
  capture="environment"
  className="visually-hidden"
  disabled={unavailable}
  onChange={(event) => void handleChange(event)}
  tabIndex={-1}
  type="file"
/>
~~~

ReservedControl 同时保留 onClick 并加入：

~~~tsx
onFocus={() => onUnavailable(label)}
~~~

- [ ] **Step 4: Expand hit boxes without changing icon scale**

在 chat.css 统一使用 2.75rem 最小尺寸：

~~~css
.composer__preview button,
.history-panel li > button:not(.history-panel__select),
.history-panel li form button,
.pwa-prompt button[aria-label] {
  min-width: 2.75rem;
  min-height: 2.75rem;
}

.drawer__language button,
.drawer__confirm button,
.history-panel__confirm button,
.status-banner button,
.pwa-prompt button {
  min-height: 2.75rem;
}
~~~

删除这些 selector 中更小的 width/height/min-height 冲突，但保留图标 size、颜色、圆角和整体构图。

- [ ] **Step 5: Verify accessibility lint and commit**

Run: npm run test:unit -- src/features/capture/CaptureButton.test.tsx src/components/chat-components.test.tsx src/pwa/UpdatePrompt.test.tsx

Expected: selected tests pass。

Run: npm run lint

Expected: exit 0；隐藏 input 不在顺序焦点中，aria-hidden 不与非负 tabIndex 冲突。

Commit:

~~~powershell
git add src/features/capture/CaptureButton.tsx src/features/capture/CaptureButton.test.tsx src/components/ControlDock.tsx src/components/chat-components.test.tsx src/styles/chat.css src/pwa/UpdatePrompt.test.tsx
git commit -m "fix: improve keyboard and touch accessibility"
~~~

---

### Task 10: Convert fire-and-forget storage actions into explicit UI results

**Files:**
- Modify: src/App.tsx
- Modify: src/components/HistoryPanel.tsx
- Modify: src/components/MenuDrawer.tsx
- Modify: src/components/app-flows.test.tsx

- [ ] **Step 1: Write failure-path RED tests**

逐个 spy 仓储/session 使其 reject，断言：

- rename 失败显示 storageFull，输入框仍存在；
- delete 失败显示 storageFull，记录和确认态仍存在；
- clearAll 失败显示 storageFull，菜单确认态仍存在；
- signOut 失败显示 genericFailure，chat 仍可见且 marker 回到 true；
- getImage 失败显示 storageFull，且用 window unhandledrejection listener 断言没有事件。

- [ ] **Step 2: Confirm RED**

Run: npm run test:unit -- src/components/app-flows.test.tsx

Expected: current handlers 丢弃 Promise；确认 UI 过早关闭，至少一个 reject 形成未处理 rejection。

- [ ] **Step 3: Add one boolean result helper in App**

~~~ts
const runUiAction = useCallback(
  async (action: () => Promise<void>, errorMessage: string): Promise<boolean> => {
    try {
      await action();
      return true;
    } catch {
      showToast(errorMessage, "error");
      return false;
    }
  },
  [showToast],
);
~~~

HistoryPanelProps 改为：

~~~ts
onDelete(id: string): Promise<boolean>;
onRename(id: string, title: string): Promise<boolean>;
~~~

MenuDrawerProps 改为：

~~~ts
onClearData(): Promise<boolean>;
onSignOut(): Promise<boolean>;
~~~

- [ ] **Step 4: Keep confirmation/edit state until success**

History rename submit：

~~~ts
void onRename(conversation.id, normalized).then((succeeded) => {
  if (succeeded) setEditingId(undefined);
});
~~~

History delete 只在 await onDelete 返回 true 后 setDeletingId(undefined)。Menu clear/signOut 也只在 true 时关闭菜单和确认态。不要在调用前 onClose。

- [ ] **Step 5: Catch App storage and session failures**

handleRename/handleDelete/handleClearData 返回 runUiAction 的 boolean。clearAll 后不再 setLocale，因为仓储已保留 settings。

显式退出用可回滚的 marker 顺序：

~~~ts
const handleSignOut = async (): Promise<boolean> =>
  runUiAction(async () => {
    await controller.stop();
    await activeServices.repository.setDeviceVerified(false);
    try {
      await activeServices.session.signOut();
    } catch (error) {
      await activeServices.repository.setDeviceVerified(true).catch(() => undefined);
      throw error;
    }
    setAuthentication("unauthenticated");
  }, copy.genericFailure);
~~~

初始 history effect 改为调用 refreshHistory。图片 URL effect 的 Promise 链增加 catch：撤销本轮已创建 URL、清空 map、在未取消时 showToast(copy.storageFull, "error")。所有 catch 都不打印 error 内容。

- [ ] **Step 6: Verify no unhandled rejections and commit**

Run: npm run test:unit -- src/components/app-flows.test.tsx

Expected: selected suite passes；失败时 UI 保留可重试状态，chat/storage 失败有本地化 Toast，unhandledrejection 为零。

Run: npm run typecheck

Expected: App、HistoryPanel、MenuDrawer 的 Promise<boolean> 契约一致。

Commit:

~~~powershell
git add src/App.tsx src/components/HistoryPanel.tsx src/components/MenuDrawer.tsx src/components/app-flows.test.tsx
git commit -m "fix: surface local action failures"
~~~

---

### Task 11: Make mock streaming slow enough to test Stop without affecting live mode

**Files:**
- Modify: types/functions.d.ts
- Modify: functions/_shared/stream.ts
- Modify: functions/api/chat.ts
- Modify: functions-tests/_shared/stream.test.ts
- Modify: functions-tests/api/chat.test.ts
- Modify: package.json

- [ ] **Step 1: Write scheduled-stream RED tests**

stream.test.ts 使用可控 scheduler 证明：

- 第一段 delta 立即出现；
- 每个后续事件等待相同 delay；
- 顺序仍是 delta、delta、done；
- reader.cancel 后即使 scheduler 继续 resolve，也不再 enqueue。

~~~ts
it("can delay mock events and stops enqueueing after cancellation", async () => {
  const releases: Array<() => void> = [];
  const response = mockChatResponse("zh-CN", {
    delayMs: 500,
    schedule: () => new Promise<void>((resolve) => releases.push(resolve)),
  });
  const reader = response.body!.getReader();

  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain("event: delta");
  expect(releases).toHaveLength(1);

  await reader.cancel();
  releases.shift()?.();
  await Promise.resolve();
  expect(releases).toHaveLength(0);
});
~~~

chat.test.ts 用 fake timers 和 MOCK_STREAM_DELAY_MS="750" 证明 mock response 在两次时间推进后完成；另用 live Env 的 MOCK_STREAM_DELAY_MS getter 抛错，证明 live 路径完全不读取该 binding。

- [ ] **Step 2: Confirm RED**

Run: npm run test:functions -- functions-tests/_shared/stream.test.ts functions-tests/api/chat.test.ts

Expected on ASCII/Linux: mockChatResponse 不接受 options，Env 没有 binding，API 始终同步输出。

- [ ] **Step 3: Add an optional mock-only binding and scheduled response**

types/functions.d.ts：

~~~ts
MOCK_STREAM_DELAY_MS?: string;
~~~

stream.ts 增加私有 options 和 response：

~~~ts
interface MockChatResponseOptions {
  delayMs?: number;
  schedule?: (delayMs: number) => Promise<void>;
}

function scheduledResponseFromEvents(
  events: ClientStreamEvent[],
  options: MockChatResponseOptions,
): Response {
  const delayMs = Math.max(0, Math.min(1_000, Math.trunc(options.delayMs ?? 0)));
  const schedule =
    options.schedule ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let cancelled = false;

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let index = 0; index < events.length; index += 1) {
          if (index > 0 && delayMs > 0) await schedule(delayMs);
          if (cancelled) return;
          controller.enqueue(encodeClientEvent(events[index]!));
        }
        if (!cancelled) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: streamHeaders() },
  );
}
~~~

mockChatResponse(locale, options = {}) 在 delayMs=0 时保留 responseFromEvents 快路径，否则使用 scheduledResponseFromEvents。

- [ ] **Step 4: Parse the binding only inside the mock branch**

~~~ts
function mockStreamDelay(env: Pick<Env, "MOCK_STREAM_DELAY_MS">): number {
  const raw = env.MOCK_STREAM_DELAY_MS ?? "";
  if (!/^\d+$/u.test(raw)) return 0;
  return Math.min(Number(raw), 1_000);
}

if (context.env.APP_MODE === "mock") {
  return mockChatResponse(request.locale, {
    delayMs: mockStreamDelay(context.env),
  });
}
~~~

不要在 wrangler.jsonc、Production/Preview 变量表或 live 分支中加入该 binding。

- [ ] **Step 5: Add a dedicated E2E server command**

package.json：

~~~json
"pretest:e2e": "npm run build",
"serve:e2e": "wrangler pages dev dist --kv RATE_LIMIT_KV --binding APP_MODE=mock --binding MOCK_STREAM_DELAY_MS=750",
"test:e2e": "playwright test"
~~~

- [ ] **Step 6: Verify and commit**

Run: npm run test:functions -- functions-tests/_shared/stream.test.ts functions-tests/api/chat.test.ts

Expected: all selected tests pass on ASCII/Linux；delay 为 0 的既有测试保持同步，live 不读取 mock binding。

Run: npm run typecheck

Expected: exit 0。

Commit:

~~~powershell
git add types/functions.d.ts functions/_shared/stream.ts functions/api/chat.ts functions-tests/_shared/stream.test.ts functions-tests/api/chat.test.ts package.json
git commit -m "test: make mock streaming controllable"
~~~

---

### Task 12: Enforce the Chromium release acceptance matrix and visual baseline

**Files:**
- Modify: playwright.config.ts
- Create: e2e/fixtures.ts
- Create: e2e/responsive.spec.ts
- Create: e2e/release-hardening.spec.ts
- Delete: e2e/yachiyo-chat.spec.ts
- Create later in Task 14 after Linux approval: e2e/__screenshots__/linux/mobile-390/release-hardening.spec.ts/yachiyo-chat-390x844.png

- [ ] **Step 1: Replace the two-project config with the exact seven-width matrix**

~~~ts
import { defineConfig, type Project } from "@playwright/test";

const baseURL = "http://127.0.0.1:8788";
const responsiveOnly = "**/responsive.spec.ts";
const complete = [responsiveOnly, "**/release-hardening.spec.ts"];
const projects: Project[] = [
  { name: "mobile-320", testMatch: responsiveOnly, use: { hasTouch: true, isMobile: true, viewport: { width: 320, height: 568 } } },
  { name: "mobile-375", testMatch: responsiveOnly, use: { hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } } },
  { name: "mobile-390", testMatch: complete, use: { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } } },
  { name: "mobile-430", testMatch: responsiveOnly, use: { hasTouch: true, isMobile: true, viewport: { width: 430, height: 932 } } },
  { name: "tablet-768", testMatch: responsiveOnly, use: { hasTouch: true, viewport: { width: 768, height: 1024 } } },
  { name: "desktop-1024", testMatch: responsiveOnly, use: { viewport: { width: 1024, height: 768 } } },
  { name: "desktop-1440", testMatch: responsiveOnly, use: { viewport: { width: 1440, height: 1000 } } },
];

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: "playwright-report" }], ["list"]]
    : "list",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{platform}/{projectName}/{testFilePath}/{arg}{ext}",
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "dark",
    contextOptions: { reducedMotion: "reduce" },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    serviceWorkers: "allow",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
      scale: "css",
    },
  },
  projects,
  webServer: {
    command: "npm run serve:e2e -- --port 8788",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
});
~~~

- [ ] **Step 2: Create deterministic fixtures and runtime guards**

~~~ts
import { expect, test as base, type Page } from "@playwright/test";

export const test = base.extend<{ runtimeGuard: void }>({
  runtimeGuard: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        let seed = 0x5a17c9e3;
        Math.random = () => {
          seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
          return seed / 0x1_0000_0000;
        };
      });
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push("console: " + message.text());
      });
      page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
      await use();
      expect.soft(errors, "browser runtime errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function enterApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("访问码").fill("yachiyo-local-access");
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.getByPlaceholder("什么都可以告诉我")).toBeVisible();
}

export async function waitForSwControl(page: Page): Promise<void> {
  await page.evaluate(async () => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}
~~~

- [ ] **Step 3: Add one responsive test executed by all seven projects**

responsive.spec.ts 登录后断言：

~~~ts
const overflow = await page.evaluate(
  () =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
    window.innerWidth,
);
expect(overflow).toBeLessThanOrEqual(1);
await expect(page.locator(".composer")).toBeInViewport();
await expect
  .poll(() =>
    page.locator(".chat-stage").evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    ),
  )
  .toBeLessThanOrEqual(Math.min(430, page.viewportSize()!.width) + 1);

await page.getByRole("button", { name: "菜单" }).click();
await expect(page.getByRole("dialog", { name: "菜单" })).toBeInViewport();
await expect(page.getByRole("button", { name: "关闭菜单" })).toBeInViewport();
~~~

- [ ] **Step 4: Add the complete mobile-390 release flows**

release-hardening.spec.ts 只由 mobile-390 project 执行，至少包含：

1. streams mock chat and matches 390 composition @visual；
2. stops a delayed mock stream and persists its partial reply；
3. restores history through an offline refresh under service-worker control；
4. keeps a cached but never-authenticated device behind the offline gate；
5. traps focus in menu/history, closes with Escape, returns focus, and makes every non-dialog sibling inert, including a visible PWA prompt；
6. switches Chinese/Japanese and exposes the hidden camera input attributes；
7. keeps the composer visible at a 390×480 viewport；
8. exposes all selected icon actions as at least 44×44 CSS px；
9. confirms Cache Storage contains no /api/session or /api/chat entries。

视觉用例开头固定限制为 Linux，其他平台只跑行为验收：

~~~ts
test("streams mock chat and matches 390 composition @visual", async ({ page }) => {
  test.skip(process.platform !== "linux", "The versioned visual baseline is Linux-only.");
  await enterApp(page);
  const input = page.getByPlaceholder("什么都可以告诉我");
  await input.fill("今天有点累");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/彩叶.*辛苦/u)).toBeVisible();
  const reply = page.getByRole("article", { name: "八千代的回复" }).last();
  await expect(reply).toHaveAttribute("data-status", "complete");
  await waitForSwControl(page);
  await expect(input).toBeVisible();
  await expect(reply).toHaveAttribute("data-status", "complete");
  const offlineReady = page.getByText("应用已可离线打开。");
  await offlineReady
    .waitFor({ state: "visible", timeout: 1_500 })
    .catch(() => undefined);
  if (await offlineReady.isVisible()) {
    await page.getByRole("button", { name: "确定" }).click();
  }
  await expect(page).toHaveScreenshot("yachiyo-chat-390x844.png", {
    fullPage: false,
  });
});
~~~

停止流核心：

~~~ts
await input.fill("停止生成验收");
await page.getByRole("button", { name: "发送" }).click();
await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
const reply = page.getByRole("article", { name: "八千代的回复" }).last();
await expect(reply).toContainText("彩叶");
const partial = await reply.textContent();
expect(partial).toBeTruthy();
await page.getByRole("button", { name: "停止" }).click();
await expect(reply).toHaveAttribute("data-status", "stopped");
await page.reload();
await expect(page.getByText(partial!)).toBeVisible();
~~~

离线首次门禁核心：

~~~ts
await page.goto("/");
await waitForSwControl(page);
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await expect(page.getByText("首次使用需要联网验证。")).toBeVisible();
await expect(page.getByLabel("访问码")).toBeDisabled();
await context.setOffline(false);
~~~

小视口核心：

~~~ts
await page.setViewportSize({ width: 390, height: 480 });
const composerBottom = await page.locator(".composer").evaluate(
  (element) => element.getBoundingClientRect().bottom,
);
expect(composerBottom).toBeLessThanOrEqual(481);
await expect(page.locator(".conversation-view")).toBeVisible();
~~~

44px 核心对 preview remove、history rename/delete、PWA dismiss 调 getBoundingClientRect，逐个断言 width >= 44 且 height >= 44。

- PWA prompt 背景隔离核心：在全新 context 中等待 `.pwa-prompt` 显示，保存 dismiss button，打开菜单后断言 `.pwa-prompt` 有 `inert`；反复 Tab 仍只在 dialog 内；用短 timeout 尝试 Playwright click 并断言它因 inert 被阻止，prompt 保持可见。关闭 dialog 后断言 inert 消失，再正常 dismiss。不要用 `force: true` 绕过浏览器命中测试。

- [ ] **Step 5: Confirm the behavior harness before accepting any baseline**

Run: npm run test:e2e -- --grep-invert "@visual"

Expected: 七个 project 的 behavioral tests 全部通过且零 console/pageerror。然后在 Linux/CI 首次运行完整 suite 时，唯一允许的失败是缺少受控 baseline 的 `@visual`，并且必须产生 actual 图；非 Linux 会跳过唯一视觉用例。不得用普通 `page.screenshot` 代替 assertion。

- [ ] **Step 6: Commit the behavior harness without manufacturing a Linux baseline**

~~~powershell
git add playwright.config.ts e2e/fixtures.ts e2e/responsive.spec.ts e2e/release-hardening.spec.ts e2e/yachiyo-chat.spec.ts package.json
git commit -m "test: enforce Chromium release acceptance"
~~~

基线此时故意不存在。Task 13 先提交 CI，Task 14 再创建 draft PR、取得 Linux actual artifact、人工审图并单独提交 baseline，从而避免“先有 PR 才能取图、先有图才能完成 Task 12”的循环。CI 永不使用 `--update-snapshots`；Windows 生成的 win32 基线不能重命名冒充 Linux 基线。

---

### Task 13: Add a testable public-build scanner, canonical Node lock, CI, and operator docs

**Files:**
- Create: scripts/verify-public-build.mjs
- Create: scripts/verify-public-build.test.mjs
- Modify: functions-tests/_shared/prompt.test.ts
- Create later only for verified false positives: .gitleaksignore
- Create: .nvmrc
- Create: .github/workflows/ci.yml
- Modify: package.json
- Modify: package-lock.json
- Modify: README.md

- [ ] **Step 1: Remove the current test copy and write scanner RED tests**

`functions-tests/_shared/prompt.test.ts` 不再硬编码任何长度达到 sentinel 阈值的规范 prompt 片段。改为从 `functions/_generated/role-prompt` import 默认值，断言 `buildSystemPrompt(locale).startsWith(rolePrompt.trim())`，并继续用短于 16 code points 的 locale/runtime token 验证 suffix。这样当前 tree 只有规范源与 generated server input 保存 prompt 正文。

使用 node:test 和临时目录，创建最小 角色提示词.txt、Git repository 与 dist。覆盖：

- 干净 dist 返回空 findings；
- 第 9 条以后的角色提示词片段、mixed-case `\\uXXXX`、`\\u{...}`、`\\xNN`、相邻短字符串拼接，以及任意未对齐的连续 16-code-point 片段都被拒绝；
- Authorization Bearer 和 sk- 形状被拒绝；
- yachiyo-local-access 被拒绝；
- STEPFUN_API_KEY、ACCESS_CODE_SHA256、SESSION_SIGNING_SECRET 字面量被拒绝；
- 带 NUL、无扩展名的普通文件仍被扫描；
- dist 根、src 根、任一后代 symlink/特殊条目都 fail closed；Linux 必跑 root-dist-symlink 与 root-src-symlink RED（Windows 无创建 symlink 权限时只跳过本地构造用例）；
- 三个分类 prefix JSON 不是去重 string array、任一项少于 6 字符或长于 12 字符、包含任何空白或跨类别重复时 fail closed；
- `--require-real-prefixes` 缺 StepFun/access-code 任一类别时失败；SESSION signing 类别必须非空，或显式声明从未创建真实值；
- 任一分类 prefix 以明文、mixed escape 或相邻短字符串拼接命中 dist / 任意 Git history blob 都失败；用纯 fixture 前缀 `abcdef` 分别构造 `a\\x62cdef` 与 `'abc' + 'def'` 的 dist、已提交后删除的历史 blob RED 用例；
- 已从当前 tree 删除、但仍存在于任意 Git blob 的角色提示词片段仍失败；历史 blob 必须复用当前树的 mixed-case escape、Unicode escape 和相邻字符串拼接解码，不得退化成只找明文的 `git grep`；
- 当前 `src/**` 或 `vite.config.ts` 直接引用根 prompt/服务端 generated prompt 时以 `client-prompt-boundary` 失败；
- 已知旧 server-test 精确位置对 `functions/_shared/prompt.test.ts` + `413ed7a221af34e33d2f5e04e76f40b06a60970a`、`functions-tests/_shared/prompt.test.ts` + `b1fa4f188a1ff2dba29794cda64e5e8917e7703c` 作为仅有历史例外；任一路径的不同 blob、任一 blob 出现在不同路径，若含 sentinel 都必须失败；
- Git 子进程报错对象即使携带 injected secret，CLI 也只输出固定错误码；
- Git repository 为 shallow、shallow 状态查询失败或返回非精确 `false` 时 fail closed，不得把可见的截断历史声称为完整历史；
- formatFinding 只输出 rule 和不可逆 file-id，不回显路径、匹配文本或 secret。

Run: node --test scripts/verify-public-build.test.mjs

Expected: FAIL because the scanner module does not exist.

- [ ] **Step 2: Implement the scanner with dependency injection**

~~~js
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const required = ["index.html", "manifest.webmanifest", "sw.js"];
const approvedHistoricalRoleLocations = new Set([
  "functions/_shared/prompt.test.ts\0" +
    "413ed7a221af34e33d2f5e04e76f40b06a60970a",
  "functions-tests/_shared/prompt.test.ts\0" +
    "b1fa4f188a1ff2dba29794cda64e5e8917e7703c",
]);
const clientPromptBoundaryMarkers = [
  "角色提示词.txt",
  "role-prompt",
  "functions/_generated/role-prompt",
  "functions\\_generated\\role-prompt",
];
const forbiddenLiterals = [
  "yachiyo-local-access",
  "STEPFUN_API_KEY",
  "ACCESS_CODE_SHA256",
  "SESSION_SIGNING_SECRET",
];
const forbiddenPatterns = [
  {
    id: "literal-bearer-token",
    regex: /Authorization\s*:\s*["']?Bearer\s+[A-Za-z0-9._~-]{16,}/iu,
  },
  { id: "api-key-shape", regex: /\bsk-[A-Za-z0-9_-]{16,}\b/iu },
];

class VerificationError extends Error {
  constructor() {
    super("PUBLIC_BUILD_SCANNER_ERROR");
    this.name = "VerificationError";
  }
}

async function walk(directory) {
  const rootEntry = await lstat(directory).catch(() => undefined);
  if (
    rootEntry === undefined ||
    !rootEntry.isDirectory() ||
    rootEntry.isSymbolicLink()
  ) {
    throw new VerificationError();
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new VerificationError();
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (entry.isFile()) files.push(target);
    else throw new VerificationError();
  }
  return files;
}

async function requireRegularFile(file) {
  const entry = await lstat(file).catch(() => undefined);
  if (entry === undefined || !entry.isFile() || entry.isSymbolicLink()) {
    throw new VerificationError();
  }
}

function normalize(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function unicodeEscaped(value, uppercase = false) {
  const hex = (number) => {
    const encoded = number.toString(16).padStart(4, "0");
    return uppercase ? encoded.toUpperCase() : encoded;
  };
  return [...value]
    .map((character) => {
      const point = character.codePointAt(0);
      if (point === undefined || point <= 0x7f) return character;
      if (point <= 0xffff) return "\\u" + hex(point);
      const offset = point - 0x10000;
      const high = 0xd800 + (offset >> 10);
      const low = 0xdc00 + (offset & 0x3ff);
      return (
        "\\u" +
        hex(high) +
        "\\u" +
        hex(low)
      );
    })
    .join("");
}

function unicodeBraced(value) {
  return [...value]
    .map((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && point > 0x7f
        ? "\\u{" + point.toString(16) + "}"
        : character;
    })
    .join("");
}

function fullyEscaped(value) {
  return [...value]
    .map((character) => {
      const point = character.codePointAt(0);
      if (point === undefined) return character;
      if (point <= 0xff) return "\\x" + point.toString(16).padStart(2, "0");
      if (point <= 0xffff) return "\\u" + point.toString(16).padStart(4, "0");
      return "\\u{" + point.toString(16) + "}";
    })
    .join("");
}

function decodeJsEscapes(value) {
  const fromHex = (match, hex) => {
    try {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    } catch {
      return match;
    }
  };
  return value
    .replace(/\\u\{([0-9a-f]{1,6})\}/giu, fromHex)
    .replace(/\\u([0-9a-f]{4})/giu, fromHex)
    .replace(/\\x([0-9a-f]{2})/giu, fromHex)
    .replace(/["'`]\s*\+\s*["'`]/gu, "");
}

export function promptPatterns(prompt) {
  const patterns = new Set();
  for (const line of prompt.split(/\r?\n/u).map(normalize)) {
    const characters = [...line];
    if (characters.length < 16) continue;
    for (let start = 0; start <= characters.length - 16; start += 1) {
      const sentinel = characters.slice(start, start + 16).join("");
      patterns.add(sentinel);
      patterns.add(JSON.stringify(sentinel).slice(1, -1));
      patterns.add(unicodeEscaped(sentinel));
      patterns.add(unicodeEscaped(sentinel, true));
      patterns.add(unicodeBraced(sentinel));
      patterns.add(fullyEscaped(sentinel));
    }
  }
  if (patterns.size === 0) throw new VerificationError();
  return [...patterns];
}

export function parsePrefixCategory(raw) {
  if (raw === undefined) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VerificationError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (value) =>
        typeof value !== "string" ||
        [...value].length < 6 ||
        [...value].length > 12 ||
        /\s/u.test(value) ||
        value !== value.trim(),
    )
  ) {
    throw new VerificationError();
  }
  const unique = [...new Set(parsed)];
  if (unique.length !== parsed.length) throw new VerificationError();
  return unique;
}

function parseNotCreatedStatus(raw) {
  if (raw === undefined) return false;
  if (raw === "not-created") return true;
  throw new VerificationError();
}

function resolveRealPrefixes({
  accessCodePrefixes,
  requireRealPrefixes,
  sessionPrefixes,
  sessionSecretNotCreated,
  stepFunPrefixes,
}) {
  if (
    requireRealPrefixes &&
    (stepFunPrefixes.length === 0 ||
      accessCodePrefixes.length === 0 ||
      (sessionPrefixes.length === 0 && !sessionSecretNotCreated) ||
      (sessionPrefixes.length > 0 && sessionSecretNotCreated))
  ) {
    throw new VerificationError();
  }
  const combined = [
    ...stepFunPrefixes,
    ...accessCodePrefixes,
    ...sessionPrefixes,
  ];
  if (new Set(combined).size !== combined.length) {
    throw new VerificationError();
  }
  return combined;
}

function includesAny(bytes, values) {
  return values.some((value) => bytes.includes(Buffer.from(value, "utf8")));
}

function containsPossiblyEncodedValue(bytes, values) {
  if (includesAny(bytes, values)) return true;
  const decoded = decodeJsEscapes(bytes.toString("utf8"));
  return values.some((value) => decoded.includes(value));
}

function containsRolePattern(bytes, rolePatterns) {
  return containsPossiblyEncodedValue(bytes, rolePatterns);
}

export function findingsForBytes(file, bytes, rolePatterns, revokedPrefixes) {
  const findings = [];
  for (const value of forbiddenLiterals) {
    if (bytes.includes(Buffer.from(value, "utf8"))) {
      findings.push({ file, rule: "forbidden-public-literal" });
    }
  }
  const ascii = bytes.toString("latin1");
  for (const { id, regex } of forbiddenPatterns) {
    if (regex.test(ascii)) findings.push({ file, rule: id });
  }
  if (containsRolePattern(bytes, rolePatterns)) {
    findings.push({ file, rule: "canonical-role-prompt" });
  }
  if (containsPossiblyEncodedValue(bytes, revokedPrefixes)) {
    findings.push({ file, rule: "revoked-secret-prefix" });
  }
  return findings;
}

export function formatFinding({ file, rule }) {
  const fileId = createHash("sha256").update(file).digest("hex").slice(0, 12);
  return "public-build verification failed: " + rule + " file-id=" + fileId;
}

function defaultRunGit(root, args, capture) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    maxBuffer: capture ? 8 * 1024 * 1024 : undefined,
    stdio: capture
      ? ["ignore", "pipe", "ignore"]
      : ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
}

function defaultReadBlob(root, objectId) {
  let result;
  try {
    result = spawnSync("git", ["cat-file", "blob", objectId], {
      cwd: root,
      encoding: null,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    throw new VerificationError();
  }
  if (
    result === undefined ||
    result.error !== undefined ||
    result.signal !== null ||
    result.status !== 0 ||
    !Buffer.isBuffer(result.stdout)
  ) {
    throw new VerificationError();
  }
  return result.stdout;
}

function checkedGit(root, args, capture, runGit) {
  let result;
  try {
    result = runGit(root, args, capture);
  } catch {
    throw new VerificationError();
  }
  if (
    result === undefined ||
    result.error !== undefined ||
    result.signal !== null ||
    result.status === null
  ) {
    throw new VerificationError();
  }
  return result;
}

function gitCommits(root, runGit) {
  const shallow = checkedGit(
    root,
    ["rev-parse", "--is-shallow-repository"],
    true,
    runGit,
  );
  if (
    shallow.status !== 0 ||
    typeof shallow.stdout !== "string" ||
    shallow.stdout.trim() !== "false"
  ) {
    throw new VerificationError();
  }
  const result = checkedGit(root, ["rev-list", "--all"], true, runGit);
  if (result.status !== 0 || typeof result.stdout !== "string") {
    throw new VerificationError();
  }
  const commits = result.stdout.split(/\r?\n/u).filter(Boolean);
  if (commits.some((commit) => !/^[a-f0-9]{40,64}$/u.test(commit))) {
    throw new VerificationError();
  }
  return commits;
}

function gitTreeEntries(root, commit, runGit) {
  const result = checkedGit(
    root,
    ["ls-tree", "-r", "-z", commit],
    true,
    runGit,
  );
  if (result.status !== 0 || typeof result.stdout !== "string") {
    throw new VerificationError();
  }
  const entries = [];
  for (const record of result.stdout.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new VerificationError();
    const metadata = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})$/u.exec(
      record.slice(0, tab),
    );
    if (metadata?.[2] === "blob" && metadata[3] !== undefined) {
      entries.push({ objectId: metadata[3], file: record.slice(tab + 1) });
    } else if (metadata === null) {
      throw new VerificationError();
    }
  }
  return entries;
}

function approvedRoleLocation(file, objectId) {
  if (
    file === "角色提示词.txt" ||
    file === "functions/_generated/role-prompt.ts"
  ) {
    return true;
  }
  return approvedHistoricalRoleLocations.has(file + "\0" + objectId);
}

function scanHistoricalBlobs({
  commits,
  readBlob,
  revokedPrefixes,
  rolePatterns,
  root,
  runGit,
}) {
  const matchByObjectId = new Map();
  let roleFound = false;
  let secretFound = false;
  for (const commit of commits) {
    for (const { file, objectId } of gitTreeEntries(root, commit, runGit)) {
      let matches = matchByObjectId.get(objectId);
      if (matches === undefined) {
        let bytes;
        try {
          bytes = readBlob(root, objectId);
        } catch {
          throw new VerificationError();
        }
        if (!Buffer.isBuffer(bytes)) throw new VerificationError();
        matches = {
          role: containsRolePattern(bytes, rolePatterns),
          secret: containsPossiblyEncodedValue(bytes, revokedPrefixes),
        };
        matchByObjectId.set(objectId, matches);
      }
      if (matches.role && !approvedRoleLocation(file, objectId)) {
        roleFound = true;
      }
      if (matches.secret) secretFound = true;
      if (
        (rolePatterns.length === 0 || roleFound) &&
        (revokedPrefixes.length === 0 || secretFound)
      ) {
        return { roleFound, secretFound };
      }
    }
  }
  return { roleFound, secretFound };
}

export function scanGitHistory({
  root,
  rolePatterns,
  revokedPrefixes,
  readBlob = defaultReadBlob,
  runGit = defaultRunGit,
}) {
  const commits = gitCommits(root, runGit);
  const { roleFound, secretFound } = scanHistoricalBlobs({
    commits,
    readBlob,
    revokedPrefixes,
    rolePatterns,
    root,
    runGit,
  });
  const findings = [];
  if (roleFound) {
    findings.push({
      file: "(public git history)",
      rule: "canonical-role-prompt-history",
    });
  }
  if (secretFound) {
    findings.push({
      file: "(git history)",
      rule: "revoked-secret-prefix-history",
    });
  }
  return findings;
}

export async function verifyPublicBuild({
  root = repositoryRoot,
  accessCodePrefixes = parsePrefixCategory(
    process.env.ACCESS_CODE_PREFIXES_JSON,
  ),
  historyScan = scanGitHistory,
  requireRealPrefixes = false,
  sessionPrefixes = parsePrefixCategory(
    process.env.SESSION_SIGNING_PREFIXES_JSON,
  ),
  sessionSecretNotCreated = parseNotCreatedStatus(
    process.env.SESSION_SIGNING_SECRET_HISTORY_STATUS,
  ),
  stepFunPrefixes = parsePrefixCategory(
    process.env.STEPFUN_KEY_PREFIXES_JSON,
  ),
} = {}) {
  const revokedPrefixes = resolveRealPrefixes({
    accessCodePrefixes,
    requireRealPrefixes,
    sessionPrefixes,
    sessionSecretNotCreated,
    stepFunPrefixes,
  });
  const dist = path.join(root, "dist");
  const distFiles = await walk(dist);
  for (const name of required) {
    await requireRegularFile(path.join(dist, name));
  }

  const promptFile = path.join(root, "角色提示词.txt");
  await requireRegularFile(promptFile);
  const prompt = await readFile(promptFile, "utf8");
  const rolePatterns = promptPatterns(prompt);
  const findings = [];
  const viteConfig = path.join(root, "vite.config.ts");
  await requireRegularFile(viteConfig);
  const clientFiles = [
    ...(await walk(path.join(root, "src"))),
    viteConfig,
  ];
  for (const file of clientFiles) {
    const bytes = await readFile(file);
    if (includesAny(bytes, clientPromptBoundaryMarkers)) {
      findings.push({ file: path.relative(root, file), rule: "client-prompt-boundary" });
    }
  }
  for (const file of distFiles) {
    const bytes = await readFile(file);
    findings.push(
      ...findingsForBytes(
        path.relative(root, file),
        bytes,
        rolePatterns,
        revokedPrefixes,
      ),
    );
  }
  findings.push(
    ...historyScan({ root, rolePatterns, revokedPrefixes }),
  );
  return findings;
}

export async function runCli({
  argv = process.argv.slice(2),
  verify = verifyPublicBuild,
  log = console.log,
  logError = console.error,
} = {}) {
  try {
    if (argv.some((argument) => argument !== "--require-real-prefixes")) {
      throw new VerificationError();
    }
    const findings = await verify({
      requireRealPrefixes: argv.includes("--require-real-prefixes"),
    });
    if (findings.length > 0) {
      for (const finding of findings) logError(formatFinding(finding));
      return 1;
    }
    log("public-build verification passed");
    return 0;
  } catch {
    logError("public-build verification failed: scanner-error");
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runCli();
}
~~~

- [ ] **Step 3: Confirm scanner GREEN**

Run: node --test scripts/verify-public-build.test.mjs

Expected: all scanner tests pass and captured errors never contain the injected secret value。

- [ ] **Step 4: Add package gates and canonical Node metadata**

package.json：

~~~json
"engines": {
  "node": ">=22.12.0 <23"
},
"scripts": {
  "test:public-build": "node --test scripts/verify-public-build.test.mjs",
  "verify:public-build": "node scripts/verify-public-build.mjs",
  "test": "npm run test:unit && npm run test:functions && npm run test:public-build",
  "verify": "npm run test && npm run typecheck && npm run lint && npm run build && npm run verify:public-build && playwright test"
}
~~~

.nvmrc 精确内容为 22.12.0。

把 lockfile registry 规范到 npmjs：

~~~powershell
npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --replace-registry-host=always
rg -n "registry\.npmmirror\.com" package-lock.json
~~~

Expected: 第二条命令无匹配。然后运行 npm ci，Expected: exit 0 且 package-lock.json 不变。

- [ ] **Step 5: Start Gitleaks from defaults and permit only reviewed fingerprints**

不要创建全局 `.gitleaks.toml` allowlist。尤其禁止 `regexTarget = "line"`、目录级 path allowlist、跳过 rule 或跳过 commit；它们允许真实 secret 与假 fixture 同行或同目录时被绕过。

首次 draft PR 让 Gitleaks 8.30.1 用默认规则扫描完整历史。若它命中已知、非生产 fixture，先在 redacted 日志中人工核对 `Commit`、`File`、`RuleID`、`StartLine`，绝不复制 `Match`、`Line` 或 secret。只把 Gitleaks 实际输出的完整 `Fingerprint` 原样单独写入 `.gitleaksignore`；fingerprint 的结构是 commit、exact path、RuleID、line，不手写、不预填示例。

若无已确认 false positive，就不要创建 `.gitleaksignore`。任何后续 commit、路径、规则或行号变化都会产生新 fingerprint 并重新失败。该文件若产生，在 Task 14 与 baseline/fix 一起单独提交并重新审查。

- [ ] **Step 6: Add the current GitHub Actions release gate**

~~~yaml
name: Release gate

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: read

concurrency:
  group: release-gate-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  CI: "true"

jobs:
  verify:
    name: Node 22 / Chromium
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Check out full history
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Scan proposed changes and install Gitleaks
        uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_VERSION: "8.30.1"
          GITLEAKS_ENABLE_COMMENTS: "false"
          GITLEAKS_ENABLE_SUMMARY: "false"
          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"

      - name: Scan the complete Git history
        run: gitleaks git --log-opts="--all" --redact=100 --verbose --exit-code=1 .

      - name: Set up Node 22.12
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: "22.12.0"
          cache: npm
          cache-dependency-path: package-lock.json

      - name: Install locked dependencies
        run: npm ci
      - name: Unit and Functions tests
        run: npm run test
      - name: Type check
        run: npm run typecheck
      - name: Lint
        run: npm run lint
      - name: Production build
        id: build
        run: npm run build
      - name: Verify public build
        id: public_build
        run: npm run verify:public-build
      - name: Install Chromium
        run: npx playwright install --with-deps chromium
      - name: Chromium acceptance
        id: e2e
        run: npx playwright test

      - name: Upload verified public build
        if: ${{ always() && steps.public_build.outcome == 'success' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: dist-${{ github.sha }}
          path: dist/
          if-no-files-found: error
          retention-days: 7

      - name: Upload Playwright failure evidence
        if: ${{ always() && steps.e2e.outcome == 'failure' }}
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: playwright-failure-${{ github.sha }}-${{ github.run_attempt }}
          path: |
            playwright-report/
            test-results/
            e2e/__screenshots__/
          if-no-files-found: error
          retention-days: 14
~~~

- [ ] **Step 7: Update the operator-facing README**

做以下明确修改：

1. 本地运行保留 npm install，并新增干净验收 npm ci 和总入口 npm run verify。
2. 新增“浏览器与视觉验收”：列出 320/375/390/430/768/1024/1440；只有 Linux 390×844 使用受控 toHaveScreenshot；基线只能人工审图后更新；CI 永不自动更新。
3. 新增“CI 质量门”：列出 test/functions/type/lint/build/public-build/Gitleaks/Chromium；dist 保留 7 天；失败 report/trace/test-results 保留 14 天；Linux ASCII path 的 Functions 为权威。
4. 明确自动化只证明 Chromium；真实 iOS/Android 软键盘和手机相机必须人工检查。
5. 明确退出只清当前浏览器 Cookie；轮换 ACCESS_CODE_SHA256 或 SESSION_SIGNING_SECRET 会让全部旧会话失效。
6. 明确 KV 非原子/最终一致，不是严格预算；生产还需 Cloudflare 边缘限速和 StepFun 硬预算/告警。
7. 加入 StepFun 开放平台隐私政策链接，并说明发送文字/图片会交给 StepFun 处理。
8. 把会回显匹配行的旧 Key `rg` 命令替换为分类、强制、隐藏输入的短前缀扫描。每项只输入 6–12 字符，多个历史值用逗号分隔；不要粘贴完整 secret：

~~~powershell
function Read-MaskedPrefixList([string]$label) {
  $secure = Read-Host -Prompt "$label（多个用逗号分隔；每项6–12字符）" -AsSecureString
  $value = [System.Net.NetworkCredential]::new("", $secure).Password
  $parts = @($value.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
  $value = $null
  $secure.Dispose()
  $parts
}
$stepFunPrefixes = @(Read-MaskedPrefixList "当前/已撤销 StepFun Key 前缀")
$accessCodePrefixes = @(Read-MaskedPrefixList "真实共享访问码前缀")
$sessionPrefixes = @(Read-MaskedPrefixList "既存 SESSION_SIGNING_SECRET 前缀；从未创建则直接回车")
$env:STEPFUN_KEY_PREFIXES_JSON = ConvertTo-Json -Compress -InputObject $stepFunPrefixes
$env:ACCESS_CODE_PREFIXES_JSON = ConvertTo-Json -Compress -InputObject $accessCodePrefixes
$env:SESSION_SIGNING_PREFIXES_JSON = ConvertTo-Json -Compress -InputObject $sessionPrefixes
if ($sessionPrefixes.Count -eq 0) {
  $env:SESSION_SIGNING_SECRET_HISTORY_STATUS = Read-Host "若从未创建真实 SESSION_SIGNING_SECRET，请精确输入 not-created"
}
$scanExitCode = 1
try {
  npm run verify:public-build -- --require-real-prefixes
  $scanExitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:STEPFUN_KEY_PREFIXES_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:ACCESS_CODE_PREFIXES_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:SESSION_SIGNING_PREFIXES_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:SESSION_SIGNING_SECRET_HISTORY_STATUS -ErrorAction SilentlyContinue
  Clear-Variable stepFunPrefixes, accessCodePrefixes, sessionPrefixes -ErrorAction SilentlyContinue
}
if ($scanExitCode -ne 0) { throw "Mandatory secret-prefix scan failed" }
~~~

三个类别使用独立 JSON，扫描器拒绝空的 StepFun/access-code 类别、重复项、跨类别相同值和未知 CLI 参数。SESSION signing 必须提供既存前缀，或精确声明 `not-created`。只记录命令 exit 0 与“3 类已检查（某类 N/A）”，不记录前缀。该人工门在 PR 创建前必须执行；CI 无法知道这些真实前缀，不能替代它。9. 部署前人工门：轮换真实 StepFun Key、配置 Production/Preview KV/Secrets、Cloudflare 边缘限速、StepFun 硬预算/告警、真实 provider canary、真实手机软键盘/相机。不得自动操作这些生产项。

- [ ] **Step 8: Verify tooling and commit**

Run:

~~~powershell
npm run test:public-build
npm run build
npm run verify:public-build
npm run typecheck
npm run lint
git diff --check
~~~

Expected: all exit 0；scanner 输出只含 passed，不含任何 secret；lockfile 无 npmmirror。

Commit:

~~~powershell
git add scripts/verify-public-build.mjs scripts/verify-public-build.test.mjs functions-tests/_shared/prompt.test.ts .nvmrc .github/workflows/ci.yml package.json package-lock.json README.md
git commit -m "ci: add the release quality gate"
~~~

---

### Task 14: Review, approve the Linux baseline, record evidence, and fast-forward main

**Files:**
- Modify: docs/superpowers/plans/2026-07-13-yachiyo-chat-release-hardening.md
- Create after human review: e2e/__screenshots__/linux/mobile-390/release-hardening.spec.ts/yachiyo-chat-390x844.png
- Create only for individually reviewed findings: .gitleaksignore
- Modify only if review finds a defect: files named by that finding

- [ ] **Step 1: Run the clean local release sequence**

~~~powershell
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
npm run test:unit
if ($LASTEXITCODE -ne 0) { throw "Unit tests failed" }
npm run test:functions
$functionsExitCode = $LASTEXITCODE
if ($functionsExitCode -ne 0 -and (Get-Location).Path -notmatch '[^\x00-\x7F]') {
  throw "Functions tests failed on an ASCII path"
}
if ($functionsExitCode -ne 0) {
  Write-Warning "Functions result is deferred only if the recorded output is the documented pre-test pool startup failure; Linux CI must still pass"
}
npm run test:public-build
if ($LASTEXITCODE -ne 0) { throw "Scanner tests failed" }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }
npm run lint
if ($LASTEXITCODE -ne 0) { throw "Lint failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Production build failed" }
npm run verify:public-build
if ($LASTEXITCODE -ne 0) { throw "Public-build verification failed" }
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed" }
npm run test:e2e -- --grep-invert "@visual"
if ($LASTEXITCODE -ne 0) { throw "Behavioral Chromium acceptance failed" }
git diff --check
if ($LASTEXITCODE -ne 0) { throw "Whitespace verification failed" }
$releaseStatus = @(git status --short)
if ($LASTEXITCODE -ne 0) { throw "Cannot inspect the release worktree" }
if ($releaseStatus.Count -ne 0) { throw "Release worktree is dirty" }
~~~

Expected:

- unit/public-build/type/lint/build/public scan exit 0；
- Functions exit 0 on ASCII/Linux；当前中文物理路径非零只可在输出明确显示“测试收集前的已知 pool 启动错误”时暂记为 deferred，必须记录精确环境错误并由后续 Linux CI 证明；任何已开始执行测试后的失败都立即停止；
- 七个宽度的 Chromium behavioral flows 通过；此时还没有 Linux baseline，不把视觉用例伪装成已通过；
- git diff --check 无输出。

然后按 README 的同一命令执行 PR 前强制人工 secret-prefix 门。每项只输入 6–12 字符，多个历史值用逗号分隔；输入被遮罩，不得粘贴完整 secret：

~~~powershell
function Read-MaskedPrefixList([string]$label) {
  $secure = Read-Host -Prompt "$label（多个用逗号分隔；每项6–12字符）" -AsSecureString
  $value = [System.Net.NetworkCredential]::new("", $secure).Password
  $parts = @($value.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
  $value = $null
  $secure.Dispose()
  $parts
}
$stepFunPrefixes = @(Read-MaskedPrefixList "当前/已撤销 StepFun Key 前缀")
$accessCodePrefixes = @(Read-MaskedPrefixList "真实共享访问码前缀")
$sessionPrefixes = @(Read-MaskedPrefixList "既存 SESSION_SIGNING_SECRET 前缀；从未创建则直接回车")
$env:STEPFUN_KEY_PREFIXES_JSON = ConvertTo-Json -Compress -InputObject $stepFunPrefixes
$env:ACCESS_CODE_PREFIXES_JSON = ConvertTo-Json -Compress -InputObject $accessCodePrefixes
$env:SESSION_SIGNING_PREFIXES_JSON = ConvertTo-Json -Compress -InputObject $sessionPrefixes
if ($sessionPrefixes.Count -eq 0) {
  $env:SESSION_SIGNING_SECRET_HISTORY_STATUS = Read-Host "若从未创建真实 SESSION_SIGNING_SECRET，请精确输入 not-created"
}
$scanExitCode = 1
try {
  npm run verify:public-build -- --require-real-prefixes
  $scanExitCode = $LASTEXITCODE
} finally {
  Remove-Item Env:STEPFUN_KEY_PREFIXES_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:ACCESS_CODE_PREFIXES_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:SESSION_SIGNING_PREFIXES_JSON -ErrorAction SilentlyContinue
  Remove-Item Env:SESSION_SIGNING_SECRET_HISTORY_STATUS -ErrorAction SilentlyContinue
  Clear-Variable stepFunPrefixes, accessCodePrefixes, sessionPrefixes -ErrorAction SilentlyContinue
}
if ($scanExitCode -ne 0) { throw "Mandatory secret-prefix scan failed" }
~~~

Expected: exit 0。Verification record 只写“已检查 3 个类别、N 个前缀；SESSION signing 为 N/A/已检查”，绝不写前缀本身。没有用户提供 StepFun/access-code 前缀或 SESSION signing 前缀/N/A 声明时在此暂停，不得声称验收标准 13 已闭环。

- [ ] **Step 2: Run the pre-PR implementation-coverage review**

读取并使用 code-review-and-quality 与 requesting-code-review。至少让一个 fresh-context reviewer 检查实现与测试映射，但明确把 Linux baseline、绿色 CI run、artifact 和 evidence commit 标为“等待 PR 后产生”，本步骤不得伪称已有最终证据。检查：

- 规格 13 条验收标准是否逐条有实现位置、本地测试或明确的 PR 后证据计划；
- session 派生、SSE EOF/200/201、动态 headers；
- marker 只用于离线壳层且在线会话仍权威；
- modal/viewport/scroll/pending image/async failure 是否有回归；
- scanner/Gitleaks 是否会泄露匹配内容或被宽泛 allowlist 绕过；
- 客户端依赖图是否仍未导入 prompt 源/生成模块，且没有用 escape 或短字符串拼接藏入角色提示词；
- Playwright 是否真的跑七宽度且视觉只由 Linux baseline 证明；
- 无 UI 大改、无严格额度、无生产部署。

所有 P0/P1/P2 finding 必须修复、运行 focused test、提交独立 fix commit，再重新做本步骤。没有 actionable finding 时记录“实现覆盖通过；Linux/CI 证据待定”。最终 13 条证据审查在 Step 6 重新由 fresh-context reviewer 执行。

- [ ] **Step 3: Push only the feature branch and open a Private draft PR**

确认 origin 仍是 https://github.com/liangcka/yachiyo-chat.git，工作树干净后：

~~~powershell
git push -u origin feature/yachiyo-chat
if ($LASTEXITCODE -ne 0) { throw "Cannot push the feature branch" }
$draftPrUrl = @(gh pr create --draft --base main --head feature/yachiyo-chat --title "Release-harden Yachiyo Chat" --body "Repository-verifiable release hardening. Plan and evidence: [implementation plan](docs/superpowers/plans/2026-07-13-yachiyo-chat-release-hardening.md). No production deployment is included.")
if ($LASTEXITCODE -ne 0) { throw "Cannot create the draft PR" }
($draftPrUrl -join "").Trim()
~~~

该短正文远低于 GitHub 65,536 字符上限；不要把整份计划用作 PR body。draft PR 只触发 Linux 权威验证，不改变 main。

- [ ] **Step 4: Resolve Gitleaks first, then approve the Linux actual image**

首次 run 按顺序处理：

1. Gitleaks 若发现真实 secret，立即停止、撤销凭据并修复历史；不得 allowlist。
2. 只有人工确认的非生产 fixture 才能把日志给出的单条精确 `Fingerprint` 写入 `.gitleaksignore`。不复制 Match/Line/secret，不创建 TOML allowlist；提交 `security: ignore reviewed fixture fingerprint` 后推送重跑。
3. Gitleaks 通过后，若唯一剩余失败是缺 Linux baseline，从 `playwright-failure-*` artifact 的 `test-results` 取得 actual 图。确认它来自 ubuntu-latest、mobile-390、390×844、deviceScaleFactor 1。
4. 人工查看候选图，确认星空、玻璃层级、底栏、消息、焦点遮罩与 430px 桌面列宽未偏离；不得批准含错误 toast、未完成流、PWA prompt 或失焦遮罩的图。
5. 把批准图放到精确路径并单独提交：

~~~powershell
git add e2e/__screenshots__/linux/mobile-390/release-hardening.spec.ts/yachiyo-chat-390x844.png
if ($LASTEXITCODE -ne 0) { throw "Cannot stage the approved Linux baseline" }
git commit -m "test: approve the Linux 390px visual baseline"
if ($LASTEXITCODE -ne 0) { throw "Cannot commit the approved Linux baseline" }
git push
if ($LASTEXITCODE -ne 0) { throw "Cannot push the approved Linux baseline" }
~~~

也可以在与 CI 相同的 Linux/Chromium 版本执行 `npm run test:e2e -- --project=mobile-390 --grep "@visual" --update-snapshots` 生成候选，但仍必须人工审图。CI 永不带 `--update-snapshots`，Windows 基线不得改名冒充 Linux。

任何非 Gitleaks-reviewed-fixture 或 baseline-missing 的失败都必须先修复、focused test、独立提交并重跑；不得把普通失败截图批准成基线。

- [ ] **Step 5: Append actual verification evidence after the first green Linux run**

在本计划底部追加 Verification record，逐行写实际 commit SHA、命令、exit code、测试数量、Functions 路径说明、Playwright project 数、绿色 GitHub Actions run URL 与 artifact 名称。只记录真实结果，不预填 PASS。

人工门保持未勾选并明确：

- [ ] 已轮换并只在 Cloudflare Secret 中配置真实 StepFun Key
- [ ] Production/Preview KV 与 Secrets 已分别配置
- [ ] Cloudflare 边缘限速已配置
- [ ] StepFun 硬预算和告警已配置
- [ ] 真实 provider canary 已通过
- [ ] 真实 iOS/Android 软键盘与相机已通过

提交并推送证据：

~~~powershell
git add docs/superpowers/plans/2026-07-13-yachiyo-chat-release-hardening.md
if ($LASTEXITCODE -ne 0) { throw "Cannot stage the verification record" }
git commit -m "docs: record release verification and manual gates"
if ($LASTEXITCODE -ne 0) { throw "Cannot commit the verification record" }
git push
if ($LASTEXITCODE -ne 0) { throw "Cannot push the verification record" }
~~~

- [ ] **Step 6: Pin the green evidence SHA, run final review, and mark the PR ready**

等待 evidence commit 的 Release gate 全绿，确认 dist 与 Playwright artifact 名称符合 README。先锁定并交叉检查当前 PR head：

~~~powershell
gh pr checks feature/yachiyo-chat --watch
if ($LASTEXITCODE -ne 0) { throw "Evidence checks are not green" }
$verifiedShaOutput = @(git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve the local evidence SHA" }
$verifiedSha = ($verifiedShaOutput -join "").Trim()
$prShaOutput = @(gh pr view feature/yachiyo-chat --json headRefOid --jq .headRefOid)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve the PR head SHA" }
$prSha = ($prShaOutput -join "").Trim()
if ($verifiedSha -notmatch '^[a-f0-9]{40}$' -or $prSha -ne $verifiedSha) {
  throw "PR head does not equal the locally verified evidence commit"
}
~~~

再次调用 code-review-and-quality 与 requesting-code-review，让 fresh-context reviewer 逐条核对 13 条验收标准的真实 Verification record、该 SHA 的绿色 Linux run、批准 baseline、artifact 和未勾选人工生产门。任一 finding 都要修复、提交、更新 evidence、重跑 CI，并从本步骤开头取得新的 `$verifiedSha`；不能沿用旧 SHA。

最终审查无 finding 后再次读取 PR head；它必须仍等于 `$verifiedSha`，再把 PR 标为 ready：

~~~powershell
$readyPrShaOutput = @(gh pr view feature/yachiyo-chat --json headRefOid --jq .headRefOid)
if ($LASTEXITCODE -ne 0) { throw "Cannot re-check the PR head" }
$readyPrSha = ($readyPrShaOutput -join "").Trim()
if ($readyPrSha -ne $verifiedSha) { throw "PR head moved during final review" }
gh pr ready feature/yachiyo-chat
if ($LASTEXITCODE -ne 0) { throw "Cannot mark the PR ready" }
~~~

任一命令失败或 head 移动都回到本步骤开头，不得把 PR 标为 ready。此时向用户展示 `$verifiedSha`、PR、绿色 run、artifact 与人工门状态，明确请求“允许把这个精确 SHA 快进到 main”。未经批准不得继续。

批准后从用户批准的消息中复制该 40 位 SHA（SHA 非 secret），并执行以下 fail-closed 检查；命令不从移动分支推断批准对象：

~~~powershell
$approvedSha = (Read-Host "粘贴用户明确批准的40位 evidence commit SHA").Trim()
if ($approvedSha -notmatch '^[a-f0-9]{40}$') { throw "Invalid approved SHA" }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "Cannot fetch origin" }
$currentPrShaOutput = @(gh pr view feature/yachiyo-chat --json headRefOid --jq .headRefOid)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve the current PR head" }
$currentPrSha = ($currentPrShaOutput -join "").Trim()
$remoteFeatureShaOutput = @(git rev-parse origin/feature/yachiyo-chat)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve origin/feature-yachiyo-chat" }
$remoteFeatureSha = ($remoteFeatureShaOutput -join "").Trim()
$localFeatureShaOutput = @(git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve the local feature head" }
$localFeatureSha = ($localFeatureShaOutput -join "").Trim()
if ($currentPrSha -ne $approvedSha -or $remoteFeatureSha -ne $approvedSha -or $localFeatureSha -ne $approvedSha) {
  throw "Feature branch moved after approval"
}
$featureStatus = @(git status --porcelain)
if ($LASTEXITCODE -ne 0) { throw "Cannot inspect the feature worktree" }
if ($featureStatus.Count -ne 0) { throw "Feature worktree is dirty" }
$mainStatus = @(git -C "D:\程序\web\Yachiyo chat" status --porcelain)
if ($LASTEXITCODE -ne 0) { throw "Cannot inspect the main worktree" }
if ($mainStatus.Count -ne 0) {
  throw "Main worktree is dirty"
}
gh pr checks feature/yachiyo-chat --watch
if ($LASTEXITCODE -ne 0) { throw "Approved SHA no longer has green PR checks" }
$landingPrShaOutput = @(gh pr view feature/yachiyo-chat --json headRefOid --jq .headRefOid)
if ($LASTEXITCODE -ne 0) { throw "Cannot re-check the PR head before landing" }
$landingPrSha = ($landingPrShaOutput -join "").Trim()
if ($landingPrSha -ne $approvedSha) { throw "PR head moved before landing" }
git -C "D:\程序\web\Yachiyo chat" switch main
if ($LASTEXITCODE -ne 0) { throw "Cannot switch the main worktree to main" }
$mainHeadOutput = @(git -C "D:\程序\web\Yachiyo chat" rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve the local main head" }
$mainHead = ($mainHeadOutput -join "").Trim()
$remoteMainBeforeOutput = @(git rev-parse origin/main)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve origin/main" }
$remoteMainBefore = ($remoteMainBeforeOutput -join "").Trim()
if ($mainHead -ne $remoteMainBefore) { throw "Local main is not exactly origin/main" }
git -C "D:\程序\web\Yachiyo chat" merge --ff-only $approvedSha
if ($LASTEXITCODE -ne 0) { throw "Fast-forward merge failed" }
$landedShaOutput = @(git -C "D:\程序\web\Yachiyo chat" rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve main after fast-forward" }
$landedSha = ($landedShaOutput -join "").Trim()
if ($landedSha -ne $approvedSha) {
  throw "Fast-forward did not land on the approved SHA"
}
git -C "D:\程序\web\Yachiyo chat" push origin main
if ($LASTEXITCODE -ne 0) { throw "Pushing main failed" }
$remoteMainRows = @(git ls-remote origin refs/heads/main)
if ($LASTEXITCODE -ne 0 -or $remoteMainRows.Count -ne 1) {
  throw "Cannot resolve the pushed remote main"
}
$remoteMainAfter = (($remoteMainRows[0] -split "`t")[0]).Trim()
if ($remoteMainAfter -ne $approvedSha) { throw "Remote main does not equal the approved SHA" }
~~~

任何检查、`--ff-only` 或普通 push 失败都必须停止并重新评估，不得 force push。成功后远端 main 精确等于用户批准且 CI 全绿的 evidence SHA；不自动删除 feature branch，不配置 Cloudflare 生产绑定，不部署。
