# 网络搜索功能（Bing 独立搜索）Spec

## Why

当前聊天只能依赖模型自身知识，无法回答时效性问题（天气、新闻等）。需要新增网络搜索能力：服务端独立调用 Bing 搜索并将结果注入对话上下文。搜索与聊天厂商完全解耦，任意厂商（stepfun/deepseek/glm/openai/claude/gemini 及服务端 fallback）都能联网，避免"其他模型或其他 API 不支持联网"的问题。

技术选型依据（已实测验证）：
- 微软旧版 Azure Bing Search API 已于 2025-08-11 退役（返回 410），无法使用。
- Bing 免费搜索输出 `https://www.bing.com/search?q=<query>&format=rss` 实测仍可用（RSS XML，含 title/link/description），无需任何 Key，故搜索步骤不新增环境变量。
- 用户提供的测试 Key（StepFun Step Plan）与模型 step-3.7-flash 仅用于本地端到端验证聊天链路，与搜索无关。

## What Changes

- **新增** 技能面板（SkillsPanel）"联网搜索"区块：两个开关——"联网搜索"（默认关）与"显示引用来源"（默认开，联网关闭时置灰），持久化到 IndexedDB settings 表。
- **新增** 服务端独立搜索模块 `functions/_shared/web-search.ts`：Bing RSS 抓取 + 解析（≤5 条结果），失败静默降级为普通对话。
- **新增** 聊天请求字段 `webSearch?: boolean`（POST /api/chat）。
- **新增** SSE 事件 `event: sources`：搜索来源（title+url）先于正文 delta 下发；前端解析后随消息持久化，回复气泡下方按"显示引用来源"开关渲染"参考来源"链接列表。
- **修改** 联网回复长度上限：普通聊天 200 → 1000 Unicode 字符（系统提示词 runtime 指令与 proxy 流式截断同步放宽；summary 模式维持 1000 不变）。
- **修改** `buildSystemPrompt` 增加可选参数，注入 `<web_search_results>` 结果块（中/日双语指令）。
- 不新增环境变量、不新增 KV/Secrets、不改 Cloudflare Pages 配置。

## Impact

- Affected specs: 无（现有 `.trae/specs/enhance-starfield-flow` 为星流动画，与本变更无关）。
- Affected code:
  - 后端：`functions/_shared/web-search.ts`（新）、`validation.ts`、`prompt.ts`、`stream.ts`、`providers/openai-compat.ts`、`providers/anthropic.ts`、`providers/gemini.ts`、`stepfun.ts`、`functions/api/chat.ts`
  - 前端：`src/data/db.ts`、`src/domain/chat.ts`、`src/services/chat-client.ts`、`src/services/web-search-settings.ts`（新）、`src/app/chat-reducer.ts`、`src/app/use-chat-controller.ts`、`src/components/SkillsPanel.tsx`、`src/components/MessageBubble.tsx`、`src/components/ConversationView.tsx`、`src/App.tsx`、`src/i18n/messages.ts`、`src/styles/*.css`
  - 测试：`functions-tests/**`、`src/**/*.test.ts(x)`、`e2e/yachiyo-chat.spec.ts`
  - 文档：`README.md`

## ADDED Requirements

### Requirement: 联网搜索开关

The system SHALL 在技能面板提供"联网搜索"开关（默认关闭）与"显示引用来源"开关（默认开启；联网搜索关闭时禁用置灰）。开关状态持久化于 IndexedDB settings 表（键 `webSearchEnabled`、`webSearchShowSources`），清除本地数据时一并重置。开启联网后，普通聊天请求携带 `"webSearch": true`；摘要压缩（summary 模式）请求永不携带。

#### Scenario: 开启后发送消息
- **WHEN** 用户在技能面板开启"联网搜索"并发送消息
- **THEN** POST /api/chat 请求体包含 `"webSearch": true`；关闭时该字段缺省

#### Scenario: 摘要压缩不受影响
- **WHEN** 触发会话压缩（summary 模式）
- **THEN** 请求不携带 webSearch，服务端不执行搜索

### Requirement: 独立 Bing 搜索步骤

The system SHALL 在服务端调用聊天厂商之前，以请求中最后一条 user 消息文本构造搜索词（trim、换行/制表符压成空格、按 Unicode 截断 100 字符，再去除疑问/语气/时间/纠错填充词与标点并合并中日文间空格、保留数字间小数点，压缩为高相关关键词；追问/纠错类消息自动拼上上一轮真实提问的关键词作为上下文，跳过问候语、以"【"开头的客户端注入消息与重复内容；归一化为空时回退原文；空文本即纯图片消息不搜索），请求 `https://www.bing.com/search?q=<urlencoded>&format=rss&mkt=<市场>&setlang=<语言>`（按请求 locale 锁定必应市场：zh-CN → mkt=zh-CN/setlang=zh-hans，ja-JP → mkt=ja-JP/setlang=ja，并携带对应 Accept-Language 与常规浏览器 User-Agent，避免出口网络被误判为其他市场），解析 RSS 提取前 5 条结果（title/url/snippet）。搜索超时 8 秒，独立于既有 30 秒主请求超时（搜索先于其启动）。

#### Scenario: 搜索成功
- **WHEN** webSearch=true 且 Bing 返回有效 RSS
- **THEN** 前 5 条结果注入系统提示词，且 `sources` 事件先于首个 delta 下发

#### Scenario: 搜索失败静默降级
- **WHEN** Bing 超时、非 200、解析失败或 0 条结果
- **THEN** 不注入搜索结果、不下发 sources 事件，对话照常进行且不向用户报错（长度上限仍按联网放宽）

#### Scenario: 纯图片消息
- **WHEN** 最后一条 user 消息文本为空
- **THEN** 跳过搜索，直接进入聊天厂商调用

### Requirement: 搜索结果注入任意厂商

The system SHALL 将搜索结果以编号列表注入 `<web_search_results>` 系统提示词块，全部 6 家厂商适配器与服务端 StepFun fallback 统一经 `buildSystemPrompt` 获取（各厂商请求体原有格式不变）。注入指令要求：优先依据搜索结果回答、结果无关可忽略、可在句末用 `[n]` 标注引用序号、保持角色人设与括号动作。联网（webSearch=true）时输出上限放宽为 1000 Unicode 字符（runtime 提示与 proxy `maxCharacters` 一致放宽为 1000，与 summary 同档）。

#### Scenario: 任意厂商联网
- **WHEN** 任一厂商（用户 Key 或服务端 fallback）+ webSearch=true
- **THEN** 该厂商请求体的系统提示词包含搜索结果块，流式截断上限为 1000 字符

### Requirement: 引用来源展示

The system SHALL 在搜索有结果时向客户端先于 delta 下发 SSE 事件：

```
event: sources
data: {"sources":[{"title":"…","url":"…"}]}
```

载荷由服务端裁剪：≤5 条、title ≤120 字符、url ≤512 字符且仅允许 http/https。前端解析后写入 `ChatMessage.sources` 并随消息持久化；"显示引用来源"开启时在 assistant 回复气泡下方渲染"参考来源"列表（`<a target="_blank" rel="noopener noreferrer">`）。正文到达前（搜索与模型等待期）不渲染来源区块，保持三点加载动画；关闭"显示引用来源"时，来源列表与正文中的 [1]、[2] 引用序号一并隐藏（仅展示层剥离，复制随之，本地存储保留原文）。

#### Scenario: 展示来源
- **WHEN** sources 事件到达且"显示引用来源"开启
- **THEN** 回复气泡下方显示来源标题链接；刷新页面后历史消息中仍显示

#### Scenario: 关闭展示
- **WHEN** "显示引用来源"关闭
- **THEN** 不渲染来源列表，消息记录中的 sources 数据保留

#### Scenario: Mock 模式可验证
- **WHEN** dev:mock 模式下开启联网发送消息（无个人 Key）
- **THEN** mock 响应先下发 2 条模拟 sources 事件再输出正文，用于 UI/e2e 验证

### Requirement: 安全面

- 请求校验：`webSearch` 必须为布尔值，否则 400 INVALID_REQUEST；顶层键白名单加入 `webSearch`；服务端专用字段（如 searchResults）不在白名单内，客户端无法伪造注入。
- 测试 Key 仅允许存在于本地 `.dev.vars`（已 gitignore）或浏览器 LLM 设置（IndexedDB），禁止写入任何 Git 跟踪文件（含 spec 文档）、前端代码或日志。该 Key 已出现在聊天会话中，正式上线前须在 StepFun 控制台轮换。
- 隐私边界：联网开启时用户消息文本会发送至 Bing（Microsoft）；README 隐私边界章节须更新说明。
- Bing RSS 为非官方接口且微软条款限定"个人非商业 RSS 聚合用途"，README 须标注该风险与未来可替换方案（如 StepFun 官方 web_search 工具）。

## MODIFIED Requirements

无（此前无对应 spec 文档化需求；本次 200→1000 字符的放宽仅作用于 webSearch=true 的请求，普通聊天与摘要行为不变）。

## REMOVED Requirements

无。
