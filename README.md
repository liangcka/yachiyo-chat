# Yachiyo Chat

Yachiyo Chat 是一个手机优先的 Cloudflare Pages PWA：以深蓝星空和磨砂玻璃 UI 提供月见八千代角色聊天、拍照识图、联网搜索（必应）、中日双语、本地历史、停止生成与离线只读。浏览器只访问同源 `/api/*`；服务端备用 StepFun 凭据只存在于 Pages Functions，用户在 LLM 设置中填写的 Key 只保存在当前浏览器并随同源聊天请求临时转发。

## 本地运行

要求 Node.js 22.12 或更高版本及 npm。

```powershell
npm install
npm run dev:mock
```

打开 Wrangler 输出的本地地址，使用仅限 mock 模式的访问码：`yachiyo-local-access`。未在 LLM 设置中激活个人 Key 时，Mock 模式只返回固定示例且不会调用模型；激活个人 Key 后会调用所选厂商并产生对应用量。StepFun 选项使用 Step Plan 专用 API，请填写 Step Plan Key。技能面板中的"联网搜索"开关默认关闭；开启后普通消息会先经服务端必应搜索再交给当前厂商回答（Mock 模式且未激活 Key 时返回固定示例来源，不实际访问必应）。

## 网络搜索

技能面板提供"联网搜索"与"显示引用来源"两个开关（默认关/开，仅保存在当前浏览器）。开启联网后：

- 服务端先以最后一条用户消息提取搜索关键词（去除疑问/语气/时间填充词与标点，如"今天上海的天气怎么样？"→"上海天气"；追问或纠错时自动结合上一轮提问，如"不对，3.7 flash已经出来了"会带上原问题的关键词），请求必应搜索的 RSS 输出（`https://www.bing.com/search?q=…&format=rss&mkt=…&setlang=…`，按界面语言锁定必应市场 zh-CN/ja-JP 并携带对应 Accept-Language，无需 API Key），取前 5 条结果注入系统提示词，再交给当前激活的任意厂商或服务端备用 StepFun 通道回答；该实现与聊天厂商解耦，不依赖各家模型自带的联网能力。摘要压缩不联网。
- 搜索失败或纯图片消息会静默降级为普通对话；联网回复的输出上限由 200 放宽到 1000 个 Unicode 字符。
- 搜索有结果时，回复下方按"显示引用来源"开关展示"参考来源"链接（仅 http/https，服务端裁剪条数与字段长度），并随消息保存在本地历史。等待回复期间保持三点加载动画，来源区块随正文一起出现；关闭"显示引用来源"后，来源列表与正文中的 [1]、[2] 引用序号一并隐藏（仅展示层，本地存储保留原文）。

注意：必应 RSS 为非官方接口，微软条款将其限定为个人非商业的 RSS 聚合用途；若需正式商用，应替换为厂商官方联网能力（如 StepFun `web_search` 工具）或商业搜索 API。

常用验证命令：

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

## Cloudflare Pages 配置

Git 构建配置：

- 构建命令：`npm run build`
- 输出目录：`dist`
- 根目录：仓库根目录
- Node.js：22.12 或更新版本

项目不生成顶层 `404.html`；Cloudflare Pages 会按其默认 SPA 规则把未命中的导航请求交给根页面。由于项目包含 Pages Functions，不使用 `_redirects` rewrite 覆盖该行为。

仓库中的 `wrangler.jsonc` 只提供本地 `wrangler pages dev` 使用的非敏感默认变量；`npm run dev:mock` 还会通过命令行加入本地 KV 绑定和 `APP_MODE=mock`。它不会代替 Cloudflare Pages 项目的云端环境配置。

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

KV 额度是面向小范围受邀用户的尽力限制，不是严格计费边界；上线时还应在 Cloudflare 为 `/api/session` 与 `/api/chat` 配置边缘速率规则，并在 StepFun 控制台设置预算告警。绑定自定义域名后，可在确认所有子域都使用 HTTPS 的前提下启用 Cloudflare HSTS。

不要把任何真实值写入 `.dev.vars.example`、Git、前端变量或 Cloudflare 普通变量。

`public/_headers` 只作用于 Pages 提供的静态资源，不会修改 Pages Functions 返回的 `/api/*` 响应；API 的 `Cache-Control: no-store` 由 Functions 自身设置，因此 `_headers` 中不配置无效的 `/api/*` 段。

## 生成访问码摘要与签名密钥

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

## 上线前密钥处理

**此前粘贴到聊天中的 StepFun API Key 已视为泄露，必须先在 StepFun 控制台撤销。不要测试、保存或部署该旧 Key；只把新生成的 Key 写入 Cloudflare 的 `STEPFUN_API_KEY` Secret。**

部署后检查：

1. 新设备无法跳过访问码门禁，错误码不会泄露内部信息。
2. 中文和日文文字请求均能流式返回，角色为月见八千代且带括号动作。
3. 相机/相册图片可预览、移除并获得基于图片的回答。
4. 停止按钮保留已生成内容；刷新后历史仍在当前设备。
5. 每日额度耗尽时显示本地化提示且不继续调用 StepFun。
6. 离线时可以打开和阅读历史，但发送与拍摄均禁用；恢复网络后自动恢复。
7. PWA 可以安装，更新只在用户确认后刷新。
8. 浏览器控制台无异常，390×844 与桌面居中布局正常。

最后执行泄漏扫描。交互式输入旧 Key 的短前缀，不要把完整旧 Key 写入命令、文件或日志：

```powershell
$oldKeyPrefix = Read-Host "旧 Key 的短前缀"
rg -n "$oldKeyPrefix|Authorization: Bearer [A-Za-z0-9]" . -g "!node_modules" -g "!dist" -g "!.git"
```

预期无匹配。静态 `dist/` 中也不应出现 `角色提示词.txt` 内容、访问码或任何 Key。

## 隐私边界

聊天记录、语言和压缩后的图片仅保存在当前浏览器 IndexedDB。服务端不保存聊天内容或图片；KV 只保存访问失败计数和按会话/日期的请求额度。退出访问不会删除本地历史，清除本地数据需要单独确认。开启"联网搜索"时，最后一条用户消息文本会由 Pages Functions 转发至必应（Microsoft）完成搜索；搜索返回的标题与链接仅用于本次回答与本地展示，参考来源随消息一起保存在当前浏览器。
