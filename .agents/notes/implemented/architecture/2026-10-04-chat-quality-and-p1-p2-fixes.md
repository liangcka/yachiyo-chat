# Agent Note: 对话时态、多气泡智能切分契约、Android权限与虚拟化嵌套重构

Status: implemented

## Problem
在对话交互体验、多端契约同步及 DOM 语义规范中存在若干关键缺陷与隐患：
1. **午夜跨天时态误判（P1）**：`formatRelativeDateDescription` 仅比对日历日期差（`diffDays === 1`），导致午夜 0 点连续对话（如 23:55 与 00:05 相隔 10 分钟）被误判为“跨天隔夜/昨晚睡得好吗”，破坏对话连续性与沉浸感。
2. **记忆压缩失败时的连续阻塞风险（P1）**：增量记忆压缩若遭遇临时网络抖动或模型输出格式异常，若缺乏冷却熔断机制，容易在连续发信时重复触发前置阻塞。
3. **多气泡粗暴单换行切割代码与列表（P2）**：`splitAssistantMessage` 在无显式分隔符时将单换行强制切分为独立气泡，导致 Markdown 代码块、有序/无序列表等结构化文本被撕裂成数十个碎片气泡。
4. **前端 multiBubble 开关未同步至服务端（P2）**：用户在设置中关闭“分条发送消息”后，配置未通过 `/api/chat` 透传，服务端 System Prompt 依然注入分条指令，前后端意图脱节。
5. **Android 原生 Camera 权限缺失**：`AndroidManifest.xml` 未声明 `android.permission.CAMERA`，部分定制系统 WebView 的 `capture="environment"` 文件选择器可能被系统安全机制拦截。
6. **虚拟化列表嵌套非法语义（HTML/A11y）**：`ConversationView` 在虚拟化开启时存在 `ol > li > div > div > li` 的非法 DOM 嵌套，破坏无障碍可访问性树并引发 React Compiler 报警。

## Decision
1. **午夜跨天连续对话智能保护**：
   - `formatRelativeDateDescription` 引入 `intervalMs` 判定，当跨日天数差为 1 但时间间隔小于 3.5 小时时，返回“跨越零点的深夜连续交流（刚跨过午夜，并非隔夜入睡醒来）”；
   - `buildTimeInstruction` 提示词更新规则：若上一条刚过去不久（如深夜跨过午夜零点连续对话），属于实时夜聊，绝不可误问“昨晚睡得好吗”。
2. **记忆压缩失败冷却熔断机制**：
   - `useChatController` 引入 `lastCompressionAttemptRef`，若自动增量压缩失败，设置 120 秒冷却时间，避免网络瞬态抖动或模型格式偏差时对后续发信造成反复阻塞。
3. **多气泡智能保护（Markdown 代码块与列表守护）**：
   - `splitAssistantMessage` 升级为状态机行解析器：
     - 代码块守卫：``` 包裹的多行内容严格作为一个整体保留在同一气泡内，禁止跨行拆分；
     - 列表项归集：紧随列表引导句（以 `:` 或 `：` 结尾）及连续数字/项目符号列表（`1. `、`- `、`* `、`• `）聚合在同一气泡中，避免列表碎片化；
     - 显式 `---` 分隔线依然具备最高优先级的确定性切分能力。
4. **前后端 multiBubble 契约端到端贯通**：
   - `validation.ts`：请求体增加 `multiBubble?: boolean` 校验并加入白名单；
   - `prompt.ts`：`SystemPromptOptions` 增加 `multiBubble`，为 `false` 时服务端 Prompt 移除 `multiBubbleInstruction`；
   - 各 Provider（`anthropic.ts`、`gemini.ts`、`openai-compat.ts`、`stepfun.ts`）在构建系统提示词时透传 `request.multiBubble`；
   - 客户端 `chat-client.ts`、`use-chat-controller.ts` 与 `App.tsx` 将设置中的 `multiBubble` 状态无缝注入流式请求。
5. **Android 原生相机权限补全**：
   - 在 `android/app/src/main/AndroidManifest.xml` 中补全 `<uses-permission android:name="android.permission.CAMERA" />` 与 `<uses-feature android:name="android.hardware.camera" android:required="false" />`。
6. **虚拟化 DOM 结构与无障碍合规化**：
   - 提取 `renderMessageContent`；在虚拟滚动模式下，视口项为 `<li role="presentation">`，内部绝对定位测量容器直接作为 `<div className="message-list__item ...">`，彻底消除 `div` 内嵌套 `li` 的非法 HTML 结构；
   - 为 TanStack Virtual 添加精准的 `react-hooks/incompatible-library` 抑制注释，消除了 ESLint 编译报警；
   - `MessageBubble` 增加组件卸载时 `longPressTimerRef` 的注销清理钩子。

## Alternatives considered
- **完全将自动记忆压缩移至空闲后台触发**：评估后保留“阈值处先压缩后发信”的核心契约，因为现有架构需要为长期记忆预留精准上下文槽位，且大量端到端测试覆盖了该边界生命周期；通过引入失败冷却期与超时防护，既解决了卡顿与重复重试痛点，又保障了架构幂等性与测试稳定。
- **仅使用空行（\n\n）切分多气泡**：单换行是用户日常发微信/Line的自然习惯，若仅允许双换行会导致真人语境下大量单换行语句无法拆分；采用“单换行切分 + 代码块/列表防护”取得了最佳平衡。

## Consequences
- **收益**：
  - 深夜跨零点连聊完全杜绝“昨晚睡得好吗”等出戏回复；
  - 代码块和清单在多气泡模式下完整呈现，不再支离破碎；
  - 关闭分条发送开关后，模型完全理解单气泡输出契约；
  - Android APK 具备合规的相机调用权限；
  - 全工程 0 Lint 错误与警告，无障碍结构 100% 规范。
- **代价**：
  - `splitAssistantMessage` 解析逻辑稍微增加，但由于只处理单次回复（通常百余字符），时间复杂度仍为 O(N)，性能影响可忽略。

## Verification
- `npm run typecheck`：通过（覆盖三份 tsconfig，0 error）
- `npm run lint`：通过（0 error，0 warning）
- `npm run test:functions`：通过（22 文件，273 测试全部通过）
- `npm run test:unit`：通过（25 文件，235 测试全部通过）
