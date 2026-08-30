---
name: dsh-pre-push-checks
description: 用于在提交、推送分支或声明任务完成前，精确选择覆盖本次变更的最小测试与检查命令，避免盲目运行全量耗时套件。
---

# Yachiyo Chat 提交与推送前验证指南 (Pre-Push Checks)

本技能用于在推送代码或提交变更前，依据变更影响范围精准执行必要的本地质量门禁。

---

## 1. 变更范围与检查矩阵

依据 `git status` 确认修改的文件层级，执行对应的最小完备验证：

| 涉及模块 | 检查命令 | 说明 |
|---|---|---|
| 前端 UI / 组件 / Hooks | `npm run test:unit` | 验证前端单元测试与组件交互 |
| 云函数 / 搜索 / API 中间件 | `npm run test:functions` | 验证 Pages Functions 与 DSH 搜索路由 |
| 跨模块接口 / 类型修改 | `npm run typecheck` | 验证三份 tsconfig（app/node/functions） |
| 代码风格与 Lint 规范 | `npm run lint` | 确保 0 lint error |
| 虚拟列表 / 渲染性能改动 | `npm run test:perf` | 验证 120 条长消息虚拟化性能与主线程防线 |
| 端到端全流程改动 | `npm run test:e2e` | 运行 Playwright 端到端全量回归 |

---

## 2. 标准本地推荐基线

对于一般代码重构或功能迭代，推荐按如下顺序执行核心基线检查：

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run test:functions
```

---

## 3. 移动端安全隔离核查

在执行任何 git commit 之前，执行状态检查：

```powershell
git status --short
```

**核查确认**：输出中不得包含任何 `android/` 目录下的变更或 `capacitor.config.ts` 的变动。
