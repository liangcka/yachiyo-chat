# Yachiyo Chat

[![CI](https://github.com/liangcka/yachiyo-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/liangcka/yachiyo-chat/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Yachiyo Chat 是一个手机优先的 AI 角色扮演聊天应用，以 Cloudflare Pages PWA 形式交付：以深蓝星空和磨砂玻璃 UI 提供月见八千代角色聊天，支持六家 LLM 厂商自由切换、拍照识图、多 Provider 级联联网搜索、可组合技能系统、用户记忆、中日双语界面、本地历史、停止生成与离线只读。浏览器只访问同源 `/api/*`；服务端备用凭据只存在于 Pages Functions，用户在 LLM 设置中填写的 Key 只保存在当前浏览器并随同源聊天请求临时转发。

> **English Overview**: Yachiyo Chat is a mobile-first Progressive Web App (PWA) for roleplay chat with Tsukimi Yachiyo, featuring a starfield frosted glass UI, multi-provider LLM settings (StepFun / DeepSeek / GLM / OpenAI / Claude / Gemini), a composable skill system, user memory, cascading web search, image capture & vision, bilingual support (zh-CN / ja-JP), local IndexedDB conversation storage, and offline capabilities. Powered by React 19, TypeScript, and Cloudflare Pages Functions.

## 核心特性

- **角色聊天**：月见八千代人设，流式输出，回复带括号动作描写，可随时停止生成并保留已生成内容。
- **多厂商 LLM**：六家厂商按国内/国际分组切换，个人 API Key 仅保存在本地浏览器。
- **拍照识图**：相机/相册图片经压缩后发送，由所选厂商的视觉模型回答。
- **联网搜索**：多 Provider 级联容灾路由，参考来源随消息本地保存。
- **技能系统**：五项可组合技能，启用后注入对话指令。
- **用户记忆**：可维护的长期记忆面板，让角色更了解你。
- **中日双语**：界面与交互支持 zh-CN / ja-JP。
- **本地历史**：聊天记录仅存于浏览器 IndexedDB，跨会话保留。
- **离线只读**：断网可阅读历史，发送与拍摄禁用，恢复网络自动复原。
- **PWA**：可安装，更新只在用户确认后刷新。

## 功能特性

### 多厂商 LLM 设置

在 LLM 设置面板中激活个人 API Key 后，聊天请求将直接调用所选厂商并产生对应用量；未激活时走服务端备用凭据（仅限受邀访问场景）。

| 分组 | 厂商 | 视觉模型 |
| ---- | ---- | -------- |
| 国内 | 阶跃星辰 StepFun（Step Plan） | 支持（step-3.7-flash） |
| 国内 | DeepSeek | 支持（vision 实验模型） |
| 国内 | 智谱 GLM | 支持（多款 flash 视觉模型） |
| 国际 | OpenAI (GPT) | 支持 |
| 国际 | Anthropic (Claude) | 支持 |
| 国际 | Google (Gemini) | 支持 |

StepFun 选项使用 Step Plan 专用 API，请填写 Step Plan Key；其余厂商请在对应控制台获取 API Key。

### 技能系统

技能面板中的技能可单独开关，启用后对应指令会注入当前对话：

| 技能 | 说明 |
| ---- | ---- |
| 深度思维 | 多步拆解与逻辑推理，输出深层见解 |
| 情感洞察 | 敏锐捕捉情绪与潜台词，提供高情商温暖共鸣 |
| 精准事实 | 严谨事实核对与抗幻觉，时序逻辑自洽 |
| 知识条理 | 结构化梳理复杂概念，清晰层次分明 |
| Humanizer | 去除文本中的 AI 味，让输出更像真人写作 |

技能面板中的"联网搜索"开关默认关闭；开启后普通消息会先经服务端搜索再交给当前厂商回答（Mock 模式且未激活 Key 时返回固定示例来源，不实际访问外网）。

### 联网搜索（DSH Harness WebRuntime）

网络搜索架构基于 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的 `packages/web/` 模块规范设计，具备多 Provider 可插拔能力、智能级联容灾路由与 `SearchSieve` 证据清洗机制：

- **智能意图门控与多词提取**：服务端先由模型（或规则兜底）判断是否需要联网，并提取精准搜索关键词（去除语气/疑问/时间填充词，追问或纠错时自动结合上下文关联）。
- **统一级联容灾路由（`SearchOrchestrator` / WebRuntime Router）**：

| Provider | 激活条件 | 特点 |
| -------- | -------- | ---- |
| DeepSeek 搜索 | 配置 `DEEPSEEK_API_KEY` | 高精准搜索与结构化证据提取 |
| Exa 神经搜索 | 配置 `EXA_API_KEY` | 专为 LLM 设计的神经语义检索 |
| Tavily 事实搜索 | 配置 `TAVILY_API_KEY` | 针对实时研究与时效事实优化 |
| Perplexity 搜索 | 配置 `PERPLEXITY_API_KEY` | 基于 Sonar 模型与精准引用 |
| Brave 搜索 | 配置 `BRAVE_API_KEY` | 隐私优先的全球独立网络索引 |
| 博查 AI 搜索 | 配置 `BOCHA_API_KEY` | 专为中文大模型优化 |
| SearXNG 元搜索 | 配置 `SEARXNG_BASE_URL` | 自建或公共开源元搜索引擎 |
| Google 自定义搜索 | 配置 `GOOGLE_SEARCH_API_KEY` 与 `GOOGLE_SEARCH_CX` | Google 索引 |
| Jina AI 语义搜索 | 配置 `JINA_API_KEY` 或开启 `ENABLE_JINA` | 直接返回纯净 Markdown 证据 |
| 免 Key 聚合兜底 | 无需配置 | Bing Multi-Route + DuckDuckGo，Round-Robin 多路检索（支持智能双市场并行：本地市场 + en-US 近 30 天权威信息） |

  可通过环境变量 `DSH_WEB_SEARCH_PROVIDER`（如 `deepseek` / `exa` / `tavily` / `perplexity` / `brave` / `bocha` / `searxng` / `google` / `jina` / `duckduckgo` / `bing`）指定首选 Provider。
- **SearchSieve 证据筛子**：自动过滤黑名单域名、低质黄页、广告跳转、登录页及语种不匹配噪音；智能双市场模式下放行权威国际来源。
- **页面正文并行抓取**：对命中 Top 3 结果并行抓取正文段落（超时静默降级为摘要），格式化注入系统提示词后由当前聊天模型回答。
- **展示与保存**：搜索失败或纯图片消息静默降级为普通对话；搜索命中时输出上限放宽至 1000 字符，并在回复下方流式展示参考来源（随 IndexedDB 历史持久化存储）。

## 技术栈

| 层 | 技术 |
| -- | ---- |
| 前端 | React 19、TypeScript、Vite、TanStack Virtual（消息列表虚拟化） |
| 本地存储 | Dexie（IndexedDB） |
| PWA | Workbox（vite-plugin-pwa）、离线只读缓存 |
| 服务端 | Cloudflare Pages Functions（TypeScript）、Workers KV（限流与配额） |
| 移动端（实验性） | Capacitor 8（Android） |
| 测试 | Vitest、Testing Library、Playwright（E2E + 性能） |

## 本地运行

要求 Node.js 22.12 或更高版本及 npm。

```powershell
npm install
npm run dev:mock
```

打开 Wrangler 输出的本地地址，使用仅限 mock 模式的访问码：`yachiyo-local-access`。未在 LLM 设置中激活个人 Key 时，Mock 模式只返回固定示例且不会调用模型；激活个人 Key 后会调用所选厂商并产生对应用量。

### 常用脚本

| 命令 | 说明 |
| ---- | ---- |
| `npm run dev` | Vite 纯前端开发模式 |
| `npm run dev:pages` | 构建后以 wrangler pages dev 运行（live 模式） |
| `npm run dev:mock` | 构建后以 wrangler pages dev 运行（mock 模式） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run typecheck` | 三份 tsconfig 全量类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm run test` | 单元测试 + 云函数测试 |
| `npm run test:unit` | 前端单元测试 |
| `npm run test:functions` | Pages Functions 测试 |
| `npm run test:e2e` | Playwright 端到端测试 |
| `npm run test:perf` | 构建 + Playwright 性能测试 |
| `npm run mob:sync` | 构建 + Capacitor Android 同步（实验性） |
| `npm run mob:build` | Android Release 构建（实验性） |

## 实验性：Android 原生应用

项目通过 Capacitor 8 提供 Android 原生壳（`android/` 目录），当前定位为**实验性功能**，构建与签名流程可能随版本调整：

```powershell
npm run mob:sync    # 构建前端并同步到 Android 工程
npm run mob:build   # 同步后执行 gradlew assembleRelease
```

签名配置参考 `android/keystore.properties.example`。日常使用建议以 Web PWA 为准。

## 测试与验证

```powershell
npm run test:unit
npm run test:functions
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

首次运行端到端测试前需要安装 Playwright 的 Chromium；Linux CI 使用 `npx playwright install --with-deps chromium`。后续无需重复安装，除非 Playwright 提示浏览器版本已更新。

仅当 Windows 仓库的物理路径含中文、且 `npm run test:functions` 出现 Cloudflare Workers 测试池的文件 URL 路径错误时，才需要使用纯 ASCII 路径规避。请从同一个 Git 远端做一次物理克隆并重新安装依赖，不要使用 `subst` 盘符映射：

```powershell
$remote = git remote get-url origin
git clone $remote C:\src\yachiyo-chat
Set-Location C:\src\yachiyo-chat
npm ci
npm run test:functions
```

该规避只针对本机 `@cloudflare/vitest-pool-workers` 的非 ASCII 文件 URL 兼容问题；Cloudflare 远程 Git 构建不会使用本机路径。

## Cloudflare Pages 部署

### 构建配置

- 构建命令：`npm run build`
- 输出目录：`dist`
- 根目录：仓库根目录
- Node.js：22.12 或更新版本

项目不生成顶层 `404.html`；Cloudflare Pages 会按其默认 SPA 规则把未命中的导航请求交给根页面。由于项目包含 Pages Functions，不使用 `_redirects` rewrite 覆盖该行为。

仓库中的 `wrangler.jsonc` 只提供本地 `wrangler pages dev` 使用的非敏感默认变量；`npm run dev:mock` 还会通过命令行加入本地 KV 绑定和 `APP_MODE=mock`。它不会代替 Cloudflare Pages 项目的云端环境配置。

### 环境绑定

在 Pages 项目的设置中，分别为 **Production** 和 **Preview** 环境创建以下绑定；不要只配置其中一个环境：

- KV namespace binding：`RATE_LIMIT_KV`
- 普通变量：

```text
STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
STEPFUN_MODEL=step-3.7-flash
DAILY_REQUEST_LIMIT=100
AUTH_ATTEMPT_LIMIT=10
```

- Secrets：
  - `STEPFUN_API_KEY`
  - `ACCESS_CODE_SHA256`
  - `SESSION_SIGNING_SECRET`

Production 和 Preview 都不要设置 `APP_MODE=mock`；应省略 `APP_MODE` 或设为 `live`。如 Preview 需要隔离配额或 StepFun 凭据，应为它绑定独立的 KV namespace 和 Secrets。

### 配额与边缘防护

KV 额度是面向小范围受邀用户的尽力限制，不是严格计费边界；上线时还应在 Cloudflare 为 `/api/session` 与 `/api/chat` 配置边缘速率规则，并在 StepFun 控制台设置预算告警。绑定自定义域名后，可在确认所有子域都使用 HTTPS 的前提下启用 Cloudflare HSTS。

不要把任何真实值写入 `.dev.vars.example`、Git、前端变量或 Cloudflare 普通变量。

`public/_headers` 只作用于 Pages 提供的静态资源，不会修改 Pages Functions 返回的 `/api/*` 响应；API 的 `Cache-Control: no-store` 由 Functions 自身设置，因此 `_headers` 中不配置无效的 `/api/*` 段。

## 安全与密钥管理

### 生成访问码摘要与签名密钥

在本机 PowerShell 中生成随机访问码并计算 SHA-256。命令只在当前会话变量中保存原文；把显示的访问码通过安全渠道交给受邀用户：

```powershell
$accessBytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($accessBytes)
} finally {
  $rng.Dispose()
}
$accessCode = [Convert]::ToBase64String($accessBytes)
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $hashBytes = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($accessCode))
} finally {
  $sha256.Dispose()
}
$digest = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
$accessCode
$digest
```

生成独立的会话签名密钥：

```powershell
$secretBytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($secretBytes)
} finally {
  $rng.Dispose()
}
[Convert]::ToBase64String($secretBytes)
```

分别把摘要和签名密钥写入 `ACCESS_CODE_SHA256`、`SESSION_SIGNING_SECRET` Secret。访问码至少应包含 16 个随机字符，签名密钥不得与访问码或 StepFun Key 复用。

部署后检查：

1. 新设备无法跳过访问码门禁，错误码不会泄露内部信息。
2. 中文和日文文字请求均能流式返回，角色为月见八千代且带括号动作。
3. 相机/相册图片可预览、移除并获得基于图片的回答。
4. 停止按钮保留已生成内容；刷新后历史仍在当前设备。
5. 每日额度耗尽时显示本地化提示且不继续调用 StepFun。
6. 离线时可以打开和阅读历史，但发送与拍摄均禁用；恢复网络后自动恢复。
7. PWA 可以安装，更新只在用户确认后刷新。
8. 浏览器控制台无异常，390×844 与桌面居中布局正常。

### 泄漏扫描

最后执行泄漏扫描。交互式输入旧 Key 的短前缀，不要把完整旧 Key 写入命令、文件或日志：

```powershell
$oldKeyPrefix = Read-Host "旧 Key 的短前缀"
rg -n "$oldKeyPrefix|Authorization: Bearer [A-Za-z0-9]" . -g "!node_modules" -g "!dist" -g "!.git"
```

预期无匹配。静态 `dist/` 中也不应出现 `角色提示词.txt` 内容、访问码或任何 Key。

## 隐私边界

聊天记录、语言和压缩后的图片仅保存在当前浏览器 IndexedDB。服务端不保存聊天内容或图片；KV 只保存访问失败计数和按会话/日期的请求额度。退出访问不会删除本地历史，清除本地数据需要单独确认。

开启"联网搜索"时，最后一条用户消息文本会由 Pages Functions 转发至当前命中的搜索服务商（按级联路由可能为 DeepSeek、Exa、Tavily、Perplexity、Brave、博查、SearXNG、Google、Jina、Bing/Microsoft 或 DuckDuckGo）完成搜索；搜索返回的标题与链接仅用于本次回答与本地展示，参考来源随消息一起保存在当前浏览器。

## 参与贡献与反馈

欢迎提交 Issue 与 Pull Request！详情请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

如发现问题或有改进建议，也可通过邮件联系：<xingyucka@qq.com>。

如发现安全漏洞，请阅读 [SECURITY.md](SECURITY.md) 了解反馈流程，不要在公开 Issue 中提交漏洞细节。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。
