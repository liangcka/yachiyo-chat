# Agent Note: 侧边栏设置重构与统一设置中心架构

Status: implemented

## Problem
在重构前，应用的侧边栏与各项设置存在如下交互与架构问题：
1. **抽屉定位与功能混杂**：侧边栏菜单（`MenuDrawer`）标题为“八千代 · 设置”，但同时混杂了会话管理（新建对话、历史记录、上下文压缩）与零散的子面板入口（模型配置、扩展技能、用户记忆）。
2. **多级弹层反复开关割裂**：用户在抽屉中点击任一设置项时，抽屉强制关闭，主界面底部再弹起独立的 Bottom Sheet；若需同时调整模型与偏好，必须退出面板并重新打开抽屉，交互链路冗长且破碎。
3. **功能分类归属不合理**：原扩展技能面板（`SkillsPanel`）杂糅了分条发送消息（多气泡回复开关）与联网搜索管道设置（总开关、时效智能检索、引用来源卡片），与真正的 AI 提示词技能职责混杂。
4. **状态缺乏可视化反馈**：侧边栏未提供当前生效的大模型内核感知，用户无法直观了解当前由哪家服务商驱动。

## Decision
1. **侧边栏结构分组与状态微标（Drawer Grouping & Engine Badge）**：
   - 顶部标头（`DrawerHeader`）集成实时模型状态胶囊微标（`activeModelLabel`），直观呈现当前生效的模型服务（如 `智谱 GLM-4.7-Flash` 或 `默认服务`），并辅以呼吸光点。
   - 导航区（`DrawerNav`）明确重构为两级模块化分区：
     - **对话管理（Session Group）**：新建对话、历史记录、压缩记忆与上下文。
     - **功能与设置（Settings Group）**：突出提供“设置中心”总入口，并保留模型服务、聊天偏好、八千代记忆与技能扩展快捷直达。
   - 保留底部语言快速切换与危险操作区，层级清晰自洽。

2. **统一设置中心架构（Unified SettingsPanel）**：
   - 新建统一设置面板 `src/components/SettingsPanel.tsx`，替代主界面中零散挂载的 `LlmSettingsPanel`、`UserMemoryPanel` 与 `SkillsPanel`，消除多面板生命周期冗余。
   - 顶部分段导航（Segmented Control / `role="tablist"`）支持 4 大分类自由无缝切换：
     - **LLM 设置（Model）**：模型服务商切换、API Key 安全输入、模型选择与设为默认。
     - **聊天偏好（Preferences）**：将分条发送消息（多气泡）与联网搜索（含智能时效检索、引用来源）独立为专有卡片配置。
     - **记忆（Memory）**：只读查看跨会话记忆，不提供编辑、清除、撤销或变更记录。
     - **技能扩展（Skills）**：纯净的提示词能力库，支持查看说明与一键开关。
   - 支持从侧边栏快捷传参直达指定 Tab（`initialTab`），并支持在面板内部自由切换。

3. **剥离与模块化解耦（Preferences Decoupling）**：
   - 将原先堆叠在技能面板中的多气泡开关与联网搜索开关完全抽离为独立的 `PreferencesTab`，技能面板净化为纯粹的 `SkillsTab`。
   - 原独立面板组件保持导出以维护兼容性，主视图通过统一设置中心聚合。

4. **移动端动效与毛玻璃美学对齐（Design & Accessibility）**：
   - 遵循规范适配移动端安全区域（`--safe-top`、`--safe-bottom`），采用星空深邃磨砂底色（`rgb(12 28 66 / 96%)`，`backdrop-filter: blur(24px)`）与发光微边框。
   - 基于 `<dialog>` 与 `usePanel` 基础设施，完备支持 `role="tablist"` / `role="tab"` / `aria-selected`、Tab 焦点循环、Escape 关闭与 Android 原生物理返回键层级响应。

## Consequences
- **收益**：
  - 侧边栏结构精简直观，设置配置一站式完成，不再出现反复打开关闭侧边栏的割裂体验。
  - 聊天偏好与技能模块职责清晰，符合真实使用心智。
  - 移动端动效平滑高级，无障碍规范完整。
- **影响**：
  - 更新了端到端测试中打开联网搜索的进入路径（由技能入口对齐为聊天偏好入口）。

## Verification
- `npm run typecheck`（三份 tsconfig 检查通过）
- `npm run lint`（ESLint 与 a11y 校验通过）
- `npm run test:unit`（28 个测试文件、274 项单元测试通过）
- `npm run test:functions`（22 个测试文件、286 项边缘函数测试通过）
