# Agent Note: 空会话新建去重与复用机制 (Empty Conversation Deduplication)

Status: implemented

## Problem
在原有的会话控制器实现中，`newConversation` 无论当前会话状态如何，均会无条件调用 `repository.createConversation` 创建并持久化新会话。当用户处于刚创建且未发送任何消息的空对话中时，若用户连续触发“新建对话”操作（如双击、重复点击菜单项或多端快速交互），系统会持续向 IndexedDB 添加无内容的空对话记录，造成会话历史无限繁殖，并极易触碰 `MAX_CONVERSATIONS` (30条) 上限抛出 `ConversationLimitError`。

## Decision
在 `useChatController` 的 `newConversation` 状态转移逻辑中引入空会话检测与复用门禁：
1. **空会话判定**：检查当前活跃会话 (`activeConversation`) 且满足 `messages.length === 0` 与 `!hasMoreHistory`。
2. **持久化有效性核验**：通过 `repository.getConversation(active.id)` 核验该空会话在底层存储中真实存在（防御删除/清空全部数据后的悬空引用）。
3. **原地复用与状态清理**：当处于有效空会话时，不再向数据库插入新记录，直接保持在当前活跃会话；同时清理当前未决暂存状态（`pendingImage`）与暂态错误码（`errorCode`）。
4. **非空会话标准分支**：当当前会话已有消息（或底层会话已被删除）时，正常执行 `createConversation` 开启新会话分支。

## Alternatives considered
- **在 UI 层（`handleNewChat`）做节流/防抖**：仅能在界面单一入口降低快速点击概率，无法约束其它调用路径（快捷键、API 调用等），且无法解决“用户过了一段时间未输入再次新建”时的重复建表问题。
- **在 IndexedDB 层自动清理未发送消息的空对话**：引入异步级联删除或后台清理增加了并发写入竞态风险，且破坏了 IndexedDB 操作的单向确定性。

## Consequences
- **正向收益**：彻底杜绝未输入内容时新建对话无限繁殖空记录的问题；保护了 30 条会话配额；提升了连续点击时的响应速度（零存储写入与零重渲染）。
- **注意事项**：在编写涉及会话创建的集成测试时，若需验证多会话场景，需确保当前会话具有消息内容后再触发新建分支。

## Verification
- `npm run test:unit`（涵盖控制器空会话复用测试与完整应用端到端交互测试，25 个测试文件 251 项测试全部通过）
- `npm run test:functions`（22 个测试文件 276 项测试全部通过）
- `npm run typecheck`（覆盖应用、Node 脚本及 Functions 三套 TypeScript 配置，0 错误）
- `npm run lint`（ESLint 规则 0 告警）
