# Agent Note: 手机端与电脑端完全分离解耦架构

Status: implemented

## Problem
在原有的工程结构中，前端界面存在以下多端耦合与体验割裂问题：
1. **单一大组件强耦合**：`App.tsx` 集中承载了全局状态、数据持久化、移动端专用胶水逻辑（Android 返回键 `useAndroidBack`、移动端 `visualViewport` 软键盘动态避让、PWA `UpdatePrompt`）以及移动端单列抽屉弹层 UI。
2. **大屏/桌面端空间浪费与操作冗余**：电脑端运行（Tauri 桌面独立应用或 PC 大屏浏览器）时，依然强制使用移动端的覆盖式全屏抽屉和居中弹层，无法常驻查看会话历史列表，也无法多任务并行查看工作区与 Agent 本地终端。
3. **平台与设备上下文混乱**：移动端专属的视口高度与物理返回键监听直接挂在顶层 `App.tsx`，对桌面端产生不必要的开销与潜在副作用。

## Decision
构建了清晰的三层分离解耦架构：
1. **共享核心层 (Shared Core)**：
   - 提取统一的视图接口契约 `SharedViewProps`（位于 `src/views/layout-types.ts`），严格收口多端共享的数据、控制器与回调动作。
   - `App.tsx` 演进为纯粹的顶层应用控制器与调度器，负责全局上下文、状态生命周期与门禁分发。
2. **响应式设备与平台路由调度器 (`useDeviceMode`)**：
   - 基于 React `useSyncExternalStore` 实现高性能无级联重绘的模式判定。
   - Tauri 独立桌面应用强制为 `"desktop"`；
   - Capacitor Android 原生壳（APK）强制为 `"mobile"`；
   - 网页浏览器环境依据 `(min-width: 1024px)` 媒体查询动态自适应，零手动刷新。
3. **移动端专用视图层 (`MobileLayout`)**：
   - 保留专为手机触控优化的紧凑顶部栏（`TopControls`）、单列对话流、底部操作 Dock（`ControlDock`）与全屏抽屉导航（`MenuDrawer`）。
   - 将 `useAndroidBack`（返回键逐层退出）与 `visualViewport`（软键盘高度适配）严格隔离封装在移动端视图内，彻底不污染桌面环境。
4. **电脑端专属工作台视图层 (`DesktopLayout`)**：
   - **左侧常驻侧边栏 (`DesktopSidebar`)**：常驻展现应用标题、新建对话按钮（带 `Ctrl+N` 快捷提示）、可即时重命名/删除的历史会话列表、以及底部工具与设置快捷入口。
   - **中间主对话工作区 (`DesktopChatArea`)**：顶部状态栏（会话标题、模型状态、联网搜索状态、压缩指示）、大屏自适应消息流、宽屏输入框。
   - **右侧多功能工具面板 (`DesktopRightPane`)**：常驻或折叠展示工作区文件树、Agent 终端命令运行与 Git 状态，并支持在右侧直接内联查看与切换 LLM 模型配置、技能、用户记忆，免除弹窗遮挡对话。
   - **桌面全局键盘快捷键**：支持 `Ctrl/Cmd+N`（新建对话）、`Ctrl/Cmd+B`（切换工作区）、`Esc`（关闭内联侧面板）。
5. **样式系统解耦**：
   - `desktop.css` 完善了三栏网格、星空毛玻璃工作台面板、桌面侧边栏与快捷键样式，与 `chat.css` 清晰解耦。

## Alternatives considered
- **仅靠 CSS media query 隐藏与显示元素**：会在 DOM 中重复挂载两套完整组件树，造成状态同步混乱和内存浪费。
- **拆分为两个独立项目构建**：增加代码同步与维护负担，破坏统一的 IndexedDB、LLM 及技能服务生态。最终采用“共享核心 + 多端专属视图层”的最佳实践。

## Consequences
- **收益**：
  - 手机端与电脑端逻辑与视图边界清晰，桌面端拥有现代 IDE 级别的三栏工作台体验，移动端保持轻量紧凑与返回键原生手感。
  - 彻底解耦移动端专属生命周期监听（软键盘、返回键），消除平台副作用。
- **代价**：
  - 新增了视图层组件文件，需通过 `SharedViewProps` 维持统一契约接口。

## Verification
- `npm run typecheck`：0 errors（覆盖三份 tsconfig）
- `npm run lint`：0 errors
- `npm run test:unit`：25 测试套件、221 测试用例全量通过（含新增的 `use-device-mode.test.ts` 与 `DesktopLayout.test.tsx`）
- `npm run test:functions`：22 测试套件、261 测试用例全量通过
- `npm run test:desktop`：Rust 单元与安全沙箱测试全量通过
