# Agent Note: 空会话全局去重、跨会话复用与垃圾清理机制 (Global Empty Conversation Deduplication & Reuse)

Status: implemented

## Problem
在原有的会话控制器实现中存在空对话繁殖与重复缺陷：
1. **当前空会话重复新建**：当用户处于刚创建且未发送任何消息的空对话中时，再次触发“新建对话”操作会持续向数据库插入无内容的空对话记录。
2. **跨会话分支产生多个空会话**：当存储中已经存在一个未使用的空对话时，用户切换至其他非空对话并在该对话中点击“新建对话”，系统会再次无条件调用 `repository.createConversation`，导致历史记录中出现两个甚至多个空对话。
3. **配额挤占与体验退化**：空会话不断堆积不仅破坏了侧边栏整洁度，还会迅速挤占 `MAX_CONVERSATIONS` (30条) 会话配额。

## Decision
在 `useChatController` 的 `newConversation` 状态机中建立**“系统内至多只存在一个未使用空对话”**的全局不变量机制：
1. **当前空会话原地复用**：若当前活跃会话 (`activeConversation`) 本身即为空（`messages.length === 0 && !hasMoreHistory`）且在存储中依然有效，直接保持在当前会话，清空输入框与暂存状态。
2. **跨会话检索与空会话复用**：若当前活跃会话为非空会话，但在会话列表中已经存在未使用的默认空会话（`messages.length === 0` 且标题为“新的对话”或“新しい会話”）：
   - 提取首个空会话作为复用目标；
   - 通过 `repository.touchConversation` 将该空会话的 `updatedAt` 更新为当前时间，使其在历史记录中置顶；
   - 同步语言配置与标题（`setConversationLocale` 与 `renameConversation`），无缝切换到该空会话；
   - 阻止向存储插入任何多余的空会话记录。
3. **自动清理历史冗余默认空会话**：若在检索过程中发现存在多个历史遗留的无消息默认空会话，顺带调用 `repository.deleteConversation` 清除多余记录，自动净化历史数据。
4. **底层契约与存储扩展**：在 `ConversationRepository` 及 `MemoryRepository` 中扩展 `touchConversation` 方法；在 `ChatRepository` 接口中声明可选辅助方法（`touchConversation?`、`renameConversation?`、`deleteConversation?`），保持严格类型与向前兼容。
5. **正常分支兜底**：仅当存储中完全不存在任何可用空会话时，才真正执行 `createConversation` 创建新会话容器。

## Alternatives considered
- **在 UI 层（`handleNewChat`）做会话 ID 路由**：UI 层无法感知多端同步或跨组件调用的生命周期，将空会话状态机收敛在 `useChatController` 核心控制器内能够保证所有调用路径（菜单、快捷键、API）的一致性。
- **允许跨会话保留多个空会话**：不仅违背用户的直觉与整洁度预期，还会导致侧边栏充斥无意义的“新的对话”项。

## Consequences
- **正向收益**：彻底解决当前会话与跨会话点击新建时空对话无限繁殖的 bug；全局保证最多仅保留 1 个默认空对话；自动治愈历史遗留的多余空对话；保护 30 条会话配额。
- **注意事项**：若用户显式重命名了某空会话（如自定义为“备忘录”），系统会将其视作用户的专有专题资产，不会作为默认空会话被强制占用或重命名。

## Verification
- `npm run test:unit`（包含跨会话空会话复用、冗余清理及完整端到端流测试，25 个测试套件 254 项测试全部通过）
- `npm run test:functions`（22 个测试套件 276 项测试全部通过）
- `npm run typecheck`（覆盖全部 tsconfig，0 错误）
- `npm run lint`（ESLint 规则 0 告警）
