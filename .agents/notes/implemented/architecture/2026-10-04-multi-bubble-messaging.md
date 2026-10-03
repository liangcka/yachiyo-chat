# Agent Note: 自主分条消息发送（Multi-Bubble Messaging）与动态流式交互

Status: implemented

## Problem
此前八千代的长回复（包含动作神态、调侃追问等不同层次内容）全被合并在单个消息气泡内渲染，导致聊天呈现出大段长文的“报告感”与“小作文感”，缺乏真实手机即时通讯（微信/Line）中一句话一条消息的即时感、呼吸感与伴侣聊天的自然温度。

## Decision
1. **提示词规范升级（Prompt Contract）**：
   - 在 `角色提示词.txt` 及 `functions/_shared/prompt.ts`（中日双语）中加入自主分条发送规范；
   - 八千代根据语境与情绪节奏，自主权衡决定单条回复还是拆分为多条独立消息连续发送（如先发动作神态或简短反应，再发具体的调侃、分享或追问）；
   - 分条时使用换行符或独占一行的 `---` 进行分隔；每条消息保持完整独立，单条内不随意换行；一句话能说清楚时正常单条发送，严禁把所有内容硬塞在同一个臃肿气泡里；
   - 执行 `npm run sync:prompt` 重新生成 `functions/_generated/role-prompt.ts`。

2. **气泡拆分与动态流式引擎（`message-splitter.ts`）**：
   - 提取纯函数 `splitAssistantMessage(text, isStreaming, enabled)`：
     - 优先支持显式分隔符（独占一行的 `---` 或 `===`），次选换行符（空行或单换行）；
     - 流式传输（isStreaming）期间：若当前流式文本遇到尾随换行符，智能追加一个动态的 Typing（跳动三点）气泡；当下一块字符到达时平滑变为文字并继续输入，复刻真人在手机那头连续发消息的输入过程；
     - 流式结束后自动过滤尾随空白项，避免空气泡残留。

3. **多气泡呈现与独立交互（`MessageBubble.tsx`）**：
   - 抽象 `SingleBubble` 子组件，单气泡场景直接渲染单个 `<article>`，实现零 DOM 包装、零样式退化与 100% 现有测试兼容；
   - 多气泡场景使用 `.message-bubble-group` 弹性容器垂直排列独立气泡，气泡宽度依内容长度自适应伸缩，间距保持即时通讯风格；
   - 上下文菜单挂载在当前点击的具体子气泡上，复制操作精确复制该子气泡的纯文本；重新生成与撤回操作则作用于该轮会话；
   - 引用来源（Sources）与截断标记（truncated）稳定锚定在气泡组末尾。

4. **配置持久化与切换控制**：
   - 在 `ConversationRepository` 与 Dexie `settings` 表中增加 `multiBubble` 配置项；
   - 在 `SkillsPanel`（技能与能力设置）中提供“分条发送消息”开关，默认开启（`true`），支持实时关闭与热重载。

## Alternatives considered
- **在数据层将单次响应拆分为多个 `ChatMessage` 存储**：
  被否决。流式期间并发插入多条消息会导致 Dexie 竞态与频繁持久化，且容易违背部分上游 LLM（如 Claude 原生 API）要求的 User 与 Assistant 严格交替规则（连发 3 条 Assistant 容易触发 400 校验失败）；同时撤回/重试需跨消息级联处理，系统脆弱性剧增。UI 气泡级拆分既能提供完全真实的多气泡视觉与流式体验，又能保持底层会话轮次的原子性与稳健性。
- **仅按双换行（空行）切分，忽略单换行**：
  被否决。大模型在自然手机聊天人设下常常使用单换行分割句子（如用户截图中的场景），若只支持空行会导致大量原本应当分条的回复仍被合并在同一气泡中，无法彻底解决用户痛点。

## Consequences
- **收益**：
  - 彻底解决长回复塞在同一个气泡的问题，极大提升日常聊天陪伴感与沉浸感；
  - 虚拟滚动（TanStack Virtual）高度由 `measureElement` 动态测量外层 `li` 容器，滚动吸底平滑自适应，完全不破坏既有虚拟化链路；
  - 提供开关兜底，兼顾不同用户的使用偏好。
- **代价**：
  - 多气泡场景 DOM 节点略微增加，但单回合气泡数通常在 1~4 个，在虚拟滚动防护下对长列表性能影响可忽略。

## Verification
- `npm run typecheck`：通过（覆盖 app、node、functions 三份 tsconfig，0 error）
- `npm run lint`：通过（0 error）
- `npm run test:unit`：25 测试套件、228 测试用例全部通过
- `npm run test:functions`：22 测试套件、261 测试用例全部通过
