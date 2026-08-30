# Agent Note: 手机移动端物理独立分轨与桌面端工程迁移

Status: implemented

## Problem
此前项目采用统一仓库混合承载桌面端（Tauri v2 + Rust Axum 本地网关 + Agent 工具沙箱）与手机移动端（Capacitor Android + Cloudflare Pages Functions + 移动 Web PWA）。随着桌面端 IDE 式工作台与 Agent 本地工具链的扩展，两端依赖与构建复杂度提升，需要将桌面端独立迁移至专用工程，使本仓库专注成为轻量纯粹的手机移动端与移动 Web PWA 工程。

## Decision
1. **完整迁移电脑桌面端**：
   - 将包含 Tauri v2、Rust 独立网关、桌面三栏工作台视图及 Agent 沙箱工具的完整独立工程迁移至独立工作目录 `Yachiyo-chat-desktop`。
2. **本仓库精简为纯手机端**：
   - 彻底剥离 `src-tauri/`、桌面端专属组件与样式（`WorkspacePanel`、`ToolCard`、`desktop.css`、`desktop-bridge.ts`）以及 `@tauri-apps/*` 相关依赖与脚本。
   - 顶层 `App.tsx` 专注装配移动端专属视图（`MobileLayout`），保留紧凑顶部控制栏、单列对话流、底部操作 Dock 与抽屉导航。
   - 保留 Android Capacitor 原生工程、PWA 离线能力、Cloudflare Pages Functions 与 DSH 级联联网搜索。

## Consequences
- **收益**：
  - 本仓库依赖大幅减少，构建与测试速度显著提升。
  - 前端渲染路径完全专精于移动设备与触摸交互，消除跨端条件分支开销。
  - 桌面独立版与手机端各自享有完全独立演进路径。
- **代价**：
  - 桌面独立功能将在新工作区中独立维护。

## Verification
- `npm run typecheck`：通过（app/node/functions 三份 tsconfig 均 0 error）
- `npm run lint`：通过（0 error）
- `npm run test:unit`：24 测试套件、216 测试用例全部通过
- `npm run test:functions`：22 测试套件、261 测试用例全部通过
