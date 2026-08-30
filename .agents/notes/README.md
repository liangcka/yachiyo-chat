# Agent Notes 决策与 RFC 体系

Agent Notes 用于记录对本项目产生深远影响的架构决策、技术选型与重大方案——详细记录**为什么这么做（Why）**、**放弃了什么替代方案（Trade-offs）** 以及**如何验证（Verification）**。

---

## 1. 目录结构与命名规范

每个 Agent Note 的路径由**生命周期**和**类别**双轴编码决定：
`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`

### 1.1 生命周期（Lifecycle）
- **`proposed/`**：待审提案。尚未实现或正在实现中的设计方案。
- **`implemented/`**：已落地决策。方案已合并且经测试验证，内容使用现在时描述最新现实。
- **`rejected/`**：已否决方案。经过深入讨论或评估后决定不予采纳的方案（保留其否决原因以防止后续重复踩坑）。
- **`archived/`**：已归档历史。决策虽然已落地但不再对后续开发产生杠杆指导作用的冻结快照。

### 1.2 分类（Class）
- `architecture`：系统架构、数据流与核心 Seam 设计（如 Dexie 存储、状态分层、云函数路由等）。
- `feature`：新增的用户可见或 Agent 可见的关键功能特性。
- `bug-fix`：重大缺陷修复或根本性问题排查。
- `simplification`：代码精简、冗余删除或依赖收敛。
- `process`：工程工具、工作流规范或 CI/门禁演进。
- `testing`：测试策略、E2E 覆盖或性能基线体系。

---

## 2. 规范模版

### 2.1 Implemented 状态模版

```markdown
# Agent Note: <标题>

Status: implemented

## Problem
<描述当前设计面临的核心痛点与背景>

## Decision
<使用现在时描述已落地的架构方案与实现机制>

## Alternatives considered
<列举评估过的其他方案及其被否决的具体原因>

## Consequences
<记录此方案带来的收益、付出的代价及后续注意事项>

## Verification
<列出已执行并通过的测试与验证命令>
```

### 2.2 Proposed 状态模版

```markdown
# Agent Note: <标题>

Status: proposed

## Problem
<描述痛点与背景>

## Proposal
<描述提议的改进方案与预期实施路径>

## Alternatives considered
<列举备选方案>

## Acceptance criteria
<完成方案所需的验收标准>

## Risks
<潜在风险与权衡>
```
