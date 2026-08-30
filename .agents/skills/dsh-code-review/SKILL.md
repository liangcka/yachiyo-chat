---
name: dsh-code-review
description: 用于审查 Yachiyo Chat 项目的代码变更与 PR。指导审查者核查 AGENTS.md 规范、严格类型、生命周期与清理、Web/PC 隔离保护、性能与测试覆盖。
---

# Yachiyo Chat 代码审查指南 (Code Review)

本技能为代码审查提供核心指引。审查的首要原则是**正确性、生命周期安全性、Web/移动端隔离完整性与性能防线**，避免细枝末节的纯主观风格纠缠。

---

## 1. 核心阻断性检查项 (Blocking Requirements)

1. **移动端隔离检查**：检查本次 diff 是否无意中修改了 `android/` 原生工程或 `capacitor.config.ts`。非用户明确指令的移动端改动一律予以阻断。
2. **生命周期与清理完整性**：
   - 检查所有的 `useEffect`、`ResizeObserver`、`addEventListener` 是否在清理函数中可靠注销。
   - 检查 `URL.createObjectURL` 生成的临时资源是否在适当时机 `revokeObjectURL`。
3. **类型安全与契约显式性**：
   - 严禁出现无类型标注或推导缺失导致的隐式 `any`。
   - API 请求/响应以及本地持久化（Dexie）入库数据必须有明确的结构校验。
4. **流式性能与渲染解耦**：
   - 检查流式 delta/thought 是否经过 rAF 节流，不得频繁触发不可变数组整体重分配。
   - 列表项组件（如 `MessageBubble`）是否保持 memo 化与稳定回调。
5. **Agent Notes 与决策同步**：
   - 涉及非局部架构、存储模式或 API 协议变更时，检查是否随 PR 提交了对应的 Agent Note。

---

## 2. 审查实操清单

- **意图与边界契约**：比对接口两端，确认数据格式在客户端与云函数中间件之间自洽。
- **无障碍与虚拟化兼容**：虚拟滚动容器禁止附加破坏可访问性树的属性（如 `aria-hidden="true"`）。
- **零思维链泄漏**：检查注释与文档中是否残存作者个人推导痕迹或中间修改历史。
- **测试有效性**：验证测试是否覆盖了真实的分支行为，而非仅仅复述实现本身。
