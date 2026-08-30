---
name: dsh-archive-agent-notes
description: 用于在 Yachiyo Chat 仓库中增加、审查、精简或归档 Agent Notes，维护决策生命周期的整洁与权威性。
---

# Yachiyo Chat Agent Notes 归档与生命周期管理

本技能用于管理 `.agents/notes/` 目录中的决策记录，保持活跃决策集精炼有力，同时完好保存历史演进记录。

---

## 1. 生命周期演进准则

- **新建提案 (`proposed/`)**：提议重大的架构设计或新 Seam。
- **提案落地 (`implemented/`)**：方案实现并经验证后，将文件移入 `implemented/`，将动词改为现在时，补充实测的 Consequences 与 Verification 证据。
- **提案否决 (`rejected/`)**：如果提议经评估不可行，移入 `rejected/` 并在一行内说明否决核心原因。
- **决策归档 (`archived/`)**：当某项已落地的设计已完全固化为基础常识、后续不再具备设计指导价值时，将其移至 `archived/` 目录并添加 `Archived: YYYY-MM-DD` 标头进行永久冻结。

---

## 2. 归档操作规范

1. 将文件从 `implemented/{class}/` 移动到 `archived/{class}/`。
2. 在文件头部 `Status: implemented` 下方紧随添加一行 `Archived: YYYY-MM-DD`。
3. 检查全局其他文档中对该 Note 的引用链接并予以更新或确认。
4. 归档后的文件为只读冻结快照，严禁后续对其修改。
