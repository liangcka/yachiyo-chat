# AGENTS.md — Yachiyo Chat 智能体工程规范与行为守则

本文件定义了针对 **Yachiyo Chat** 仓库的权威 Agent 开发规范。所有协助本项目的 AI 智能体（无论运行在何种平台）均必须严格遵守本守则。

---

## 1. 核心约束与运行边界

### 1.1 手机移动端与 Web 交付
- **移动端原生与构建规范**：支持 `android/` 目录下的 Capacitor Android 原生工程与顶层 `capacitor.config.ts` 构建输出 APK。
- **专注 Web / 移动端与云函数**：所有功能迭代、UI 自适应、性能优化与测试验证以手机端、PC 移动视图浏览器（Web PWA）与 Cloudflare Pages Functions 架构为主。

### 1.2 交互与文档语言
- **全程使用中文**：所有的思考推演、代码注释、提交说明、架构设计与用户交互均以**中文**进行。

### 1.3 决策与假设原则
- **不确定必须提问，严禁凭空假设**：当遇到需求歧义、破坏性变更或底层选型分歧时，必须主动向用户确认。
- **DRY 原则优先**：开发新功能前必须先检索项目中既有的实现与工具函数，严禁重复造轮子。
- **临时文件即时清理**：任何临时任务规划（如临时生成的 markdown、排查日志脚本等）在任务完成前必须彻底删除，不得残留于仓库。

---

## 2. 仓库架构与目录划分

```text
src/              前端核心源码（React 19 + TypeScript + Vite + Dexie）
  app/            应用级控制器、状态 Reducer 与生命周期 hooks
  components/     UI 组件层（星空画布、消息气泡、抽屉设置等）
  domain/         核心领域模型与 LLM 类型定义
  data/           本地持久化与 IndexedDB 存储（Dexie.js）
  features/       特定业务功能模块（捕获、视觉识图等）
  i18n/           中日双语国际化支持
  styles/         全局与组件样式
functions/        Cloudflare Pages Functions（服务端中间件与边缘 API）
  api/            API 路由入口（/api/chat、/api/session 等）
  _shared/        边缘共享逻辑（加密、会话鉴权、速率限制、模型 Provider）
  _shared/web-search/ 模块化联网搜索管道（基于 DSH WebRuntime 架构）
android/          移动端 Capacitor Android 原生工程（输出 Android APK）
.agents/          智能体体系
  notes/          Agent Notes 决策记录与 RFC 架构（proposed / implemented / rejected / archived）
  skills/         智能体技能库（代码审查、预检查、代码精简、文风规范等）
```

---

## 3. 核心开发规范与模式

### 3.1 严格类型与显式契约
- 全项目开启严格类型检查（`strict: true`），严禁无理由使用 `any`。
- 函数与公共 API 必须具有明确的入参与返回值类型；边界数据（网络请求、本地存储、外部模型输出）必须进行严密的校验。

### 3.2 生命周期与防御性模式
- **Effect 与订阅管理**：所有事件监听器（`ResizeObserver`、`window.addEventListener` 等）在组件卸载时必须在清理函数中显式注销。
- **IndexedDB 并发与版本控制**：Dexie 内部版本与原生 IndexedDB 换算必须保持幂等，避免多实例竞态写入。
- **流式响应与渲染解耦**：模型流式传输高频更新必须采用 rAF 节流或分块解耦，避免阻塞主线程渲染。

### 3.3 文风与零思维链泄漏 (Zero CoT Leakage)
- 代码注释用于说明“为什么这么做”以及非显式的契约逻辑，严禁罗列显而易见的控制流步骤。
- 严禁在代码、文档中残留会话推导痕迹（如“经过第N轮讨论”、“根据上次修改”、“修复了刚刚的bug”等）。所有提交内容必须从 HEAD 仓库当前状态视角自洽成立。

### 3.4 提示词与静态资产同步
- 修改 `角色提示词.txt` 后，必须执行 `npm run sync:prompt` 重新生成 `functions/_generated/role-prompt.ts`。

---

## 4. Agent Notes 决策记录机制

任何**非局部、影响架构、修改契约、调整状态生命周期或变更协议**的改动，必须在同一变更中在 `.agents/notes/` 目录下创建或更新对应的 Agent Note：

- 格式遵循：`.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`
- 详见 [.agents/notes/README.md](.agents/notes/README.md)。

---

## 5. 质量门禁与精准验证指南

在提交或声称变更完成前，必须依据变更影响范围运行最小但完备的验证命令：

| 变更范围 | 必须运行的验证命令 |
|---|---|
| 前端组件与业务逻辑 | `npm run test:unit` |
| 服务端 Functions / 搜索 / API | `npm run test:functions` |
| 类型定义与接口变更 | `npm run typecheck`（覆盖三份 tsconfig） |
| 代码格式与静态规范 | `npm run lint` |
| 渲染/虚拟列表性能与长列表 | `npm run test:perf` |
| 全量端到端主流程 | `npm run test:e2e` |

> [!TIP]
> 运行日常检查时，可优先执行 `npm run typecheck && npm run lint && npm run test:unit && npm run test:functions` 作为本地基线门禁。
