# Agent Note: 前端逻辑层按领域拆分

Status: implemented

## Problem
- `App.tsx` 同时承担服务装配、门禁状态机、LLM/技能/联网搜索/分条消息设置、会话列表、图片 Blob URL 缓存、输入草稿、全局粘贴与跨领域编排，单文件状态与副作用交织，任何改动都要通读全部 effect 依赖。
- `use-chat-controller.ts` 把契约类型、rAF 流式合批、请求上下文拼装、会话窗口加载与 Hook 编排放在同一文件，撤回/重生成/卸载中重复手写“中止压缩 + 解除当前生成”的序列。
- `SharedViewProps` 是四十余个扁平字段，布局组件需要逐个解构，`imageErrorMessage` / `controllerErrorMessage` 在 `App.tsx` 与 `layout-types.ts` 各有一份。
- 移动端软键盘、底栏收起与高度测量逻辑直接写在 `MobileLayout` 中，与弹层和渲染混杂。

## Decision
- **组合根**：`App.tsx` 只装配领域 Hook 并编排跨领域操作（新建/删除/清除数据/撤回后回填草稿），再交给布局渲染。
- **领域 Hook（`src/app/`）**：
  - `app-services.ts`：`AppRepository` / `SessionService` / `AppServices` 契约与生产实例，`resolveAppServices` 为未注入的设置服务回退生产数据库。
  - `use-authentication.ts`（门禁状态机）、`use-llm-settings.ts`、`use-chat-preferences.ts`（技能/联网搜索/分条消息）、`use-onboarding.ts`、`use-conversation-list.ts`、`use-image-urls.ts`、`use-composer-draft.ts`、`use-global-image-paste.ts`、`use-toast.ts`、`error-messages.ts`。
  - 轻提示文案支持 `(copy) => string` 延迟解析，语言尚未加载的底层 Hook 也能发出本地化提示，不必反向依赖控制器。
  - 切换类偏好基于 ref 镜像的最新值计算，不在 `setState` 更新函数里写存储。
- **聊天控制器（`src/app/chat/`）**：`contracts.ts`（仓储与控制器契约）、`stream-batcher.ts`、`request-context.ts`（请求上限、上下文前缀、历史预算、时间感知字段）、`conversation-loading.ts`（窗口化加载、复用空会话）。Hook 内以 `abortCompression` / `detachActiveRun` / `interruptBackgroundWork` / `beginBackgroundTask` 收敛重复的中止与后台任务序列；`selectVisibleMessages` 归入 `chat-reducer.ts`。`use-chat-controller.ts` 继续导出契约类型作为模块公共面。
- **视图契约**：`SharedViewProps` 收敛为 `composer` / `messageActions` / `conversations` / `settings` / `onboarding` / `account` 等模型；`MobileLayout` 的键盘与底栏联动抽为 `views/mobile/use-keyboard-aware-dock.ts`。
- `LlmProviderEntry` 移至 `domain/llm.ts`，应用层不再从组件文件取类型。

## Alternatives considered
- **引入全局状态库（Zustand/Redux）**：现有状态天然按领域分片且只有单一布局消费，额外依赖与样板收益有限。
- **把控制器进一步拆成多个共享 ref 的 Hook**：生成、压缩、记忆整理共享同一组中止控制器与持久化队列，强拆会把隐式时序耦合摊到 Hook 边界上；先抽纯函数与收敛重复序列，保持单一编排点。

## Consequences
- 各领域状态可单独阅读与测试，`App.tsx` 由 745 行降至约 300 行，控制器主体减少约四分之一。
- 行为保持不变，以下边界顺带收紧：启动时只回写真正被改为 `stopped` 的残留消息（原实现在存在更早历史时按错位下标全部重写）；会话列表与图片读取的异步失败不再产生未处理的 Promise 拒绝；已失效的图片加载不再写入 Blob URL 缓存。
- 新增布局只需消费 `SharedViewProps` 模型，不再逐个透传回调。

## Verification
- `npm run typecheck`：三份 tsconfig 0 错误
- `npm run lint`：0 问题
- `npm run test:unit`：43 个测试文件、553 个用例通过
- `npm run test:functions`：24 个测试文件、319 个用例通过
- `npm run test:e2e`：本地未安装 Playwright 浏览器，未执行；相关用例已同步到侧边栏内嵌会话列表
