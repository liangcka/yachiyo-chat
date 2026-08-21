# Tasks

## 后端（functions/）

- [x] Task 1: 新建 Bing 搜索模块 `functions/_shared/web-search.ts`
  - 导出 `WebSearchResult { title; url; snippet }`、`parseBingRss(xml): WebSearchResult[]`（纯函数：正则提取 item 的 title/link/description、HTML 实体解码、≤5 条、title≤120/snippet≤300/url≤512 字符、仅保留 http/https 链接）
  - 导出 `searchWeb(query, signal): Promise<WebSearchResult[]>`：GET `https://www.bing.com/search?q=<encoded>&format=rss`，常规 UA，8 秒超时；任何异常/非 200/解析失败/空结果统一返回 `[]`
  - 导出查询词构造（最后一条 user 消息文本去换行、截断 100 字符；空文本返回 null）
  - 单元测试（`functions-tests/_shared/web-search.test.ts`）：RSS fixture 解析、实体解码、条数/长度裁剪、非法 URL 过滤、超时与异常降级
- [x] Task 2: 请求校验与提示词注入
  - `validation.ts`：`ClientChatRequest` 增加 `webSearch?: boolean`；`allowedTopLevelKeys` 加入 `"webSearch"`；非布尔值 → ChatValidationError（+测试）
  - `prompt.ts`：`buildSystemPrompt(locale, mode, options?: { webSearch?: boolean; searchResults?: readonly WebSearchResult[] })`——webSearch 时 runtime 段输出上限改为 1000 字符；有 searchResults 时追加 `<web_search_results>` 编号结果块与引用指令（zh-CN / ja-JP 双语）（+测试）
- [x] Task 3: SSE `sources` 事件与流式支持（`stream.ts`）
  - `ClientStreamEvent` 增加变体 `{ type: "sources"; sources: ReadonlyArray<{title; url}> }`；`encodeClientEvent` 支持编码
  - `proxyStepFunStream`（即 `proxyProviderStream`）增加可选 `initialEvents?: ClientStreamEvent[]`，在读取 upstream 之前先入队
  - `collectClientEvents` 解析 sources 事件（测试辅助）
  - `mockChatResponse(locale, mode, webSearch?)`：webSearch 时先返回 2 条模拟 sources 再输出正文（+测试）
- [x] Task 4: 厂商适配器接入搜索上下文
  - 定义服务端内部类型：校验后的请求对象附加 `webSearch`/`searchResults`（客户端 JSON 无法携带，白名单已保证）
  - `providers/openai-compat.ts`、`providers/anthropic.ts`、`providers/gemini.ts`、`stepfun.ts`：body 构建时把 `webSearch`/`searchResults` 传入 `buildSystemPrompt`（各厂商原有请求格式不变）（+测试）
- [x] Task 5: `functions/api/chat.ts` 编排搜索步骤
  - 用户 Key 路径与服务端 fallback 路径：`webSearch === true && mode !== "summary"` 时，在 `prepareUpstreamFetch` 之前执行 `searchWeb`（独立 8s AbortController，并联动客户端 abort 信号）
  - 搜索结果注入请求对象；有结果时 `initialEvents` 携带 sources 事件（title+url，不含 snippet）
  - `maxCharacters`：`mode === "summary" || webSearch === true ? 1000 : 200`
  - mock 分支：`mockChatResponse(locale, mode, request.webSearch)`（+测试：注入、空结果降级、长度上限、mock sources）

## 前端（src/）

- [x] Task 6: 设置持久化
  - `data/db.ts`：`AppSetting` 联合类型增加 `{ key: "webSearchEnabled"; value: boolean }`、`{ key: "webSearchShowSources"; value: boolean }`（无索引变更，不需版本升级）
  - 新建 `services/web-search-settings.ts`（模式参照 skill-settings.ts）：读取/保存/清除两个开关，缺省值 enabled=false、showSources=true（+测试）
- [x] Task 7: 数据流与请求契约
  - `domain/chat.ts`：`ChatMessage` 增加 `sources?: ReadonlyArray<{ title: string; url: string }>`
  - `services/chat-client.ts`：`StreamChatRequest` 增加 `webSearch?: boolean`；SSE 解析增加 `event: sources` → `StreamChatOptions.onSources?(sources)` 回调（+测试）
  - `app/chat-reducer.ts`：新 action `sources-received { messageId, sources }`（+测试）
  - `app/use-chat-controller.ts`：`ChatControllerOptions` 增加 `webSearchEnabled?: boolean`（ref 保持最新）；`startAssistant` 请求在 enabled 时携带 `webSearch: true`（summary 压缩不携带）；`onSources` → emit + 写入 run（部分持久化与最终消息均含 sources）（+测试）
- [x] Task 8: 技能面板开关 UI
  - `components/SkillsPanel.tsx`：技能列表下方新增"联网搜索"区块，含两个开关（"显示引用来源"在联网关闭时 disabled）；props 增加状态与回调
  - `i18n/messages.ts`：zh-CN / ja-JP 文案（联网搜索、搜索说明、显示引用来源、参考来源等）并更新 `messages.test.ts`
  - 样式（复用 skills-panel 开关样式，`styles/*.css`）（+组件测试）
- [x] Task 9: 消息来源渲染与装配
  - `components/MessageBubble.tsx`：assistant 消息有 `sources` 且显示开关开启时渲染"参考来源"链接列表（`target="_blank" rel="noopener noreferrer"`）
  - `components/ConversationView.tsx` / `App.tsx`：传递 showSources；App 读写 web-search-settings，传递 `webSearchEnabled` 给 controller；清除本地数据时重置开关（+测试）

## 测试与验证

- [x] Task 10: e2e 用例（mock 模式，`e2e/yachiyo-chat.spec.ts` 或新 spec）
  - 开启联网搜索 → 发送消息 → 回复下方显示 mock 参考来源；关闭"显示引用来源" → 不显示；关闭联网 → 无来源区块
- [x] Task 11: 文档与全量验证
  - README：功能说明、隐私边界（联网时消息文本发送至 Bing）、Bing RSS 非官方接口风险与可替换方案、本地验证步骤
  - `npm run test:unit`、`npm run test:functions`、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run test:e2e` 全部通过
- [x] Task 12: 真实 API 浏览器验证（使用会话中提供的 StepFun 测试 Key 与模型 step-3.7-flash，browser_use/computer-use 自动化）
  - `npm run dev:mock` → 访问码进入 → LLM 设置激活 StepFun（测试 Key + step-3.7-flash）→ 开启联网搜索 → 提问时效性问题（如"今天上海天气"）→ 验证回复含新鲜信息且"参考来源"链接可点击
  - 复查：测试 Key 未出现在任何 Git 跟踪文件中（`git grep` 校验）

# Task Dependencies

- Task 2、3 依赖 Task 1 的接口约定（可先行定接口再并行实现）
- Task 4 依赖 Task 2（prompt 签名）；Task 5 依赖 Task 1–4
- Task 6–9 依赖 Task 2/3 定义的请求与 SSE 契约，可与后端 Task 4/5 并行
- Task 10 依赖 Task 5、9；Task 11 依赖全部；Task 12 依赖 Task 11
