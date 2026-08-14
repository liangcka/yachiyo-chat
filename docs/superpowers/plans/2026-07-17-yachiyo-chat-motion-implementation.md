# Yachiyo Chat 动效系统实施计划

日期：2026-07-17

## 架构决策

- 以 CSS motion tokens 管理跨组件共享的节奏和重复时序；少量与单一状态绑定的例外时序可在样式规则中局部定义，组件保持无动画依赖。
- 按“环境 → 入场 → 状态 → 微交互”分层，连续动画只作用于合成友好属性。
- 用 Playwright 的计算样式验证真实浏览器行为，并把 reduced-motion 作为硬性契约。

## 任务 1：建立动效契约（RED）

**验收标准：**

- 主界面关键层、弹层和环境伪元素都被浏览器测试覆盖。
- reduced-motion 测试覆盖时长与迭代次数。
- 测试在当前基线代码上按预期失败。

**验证：** `npx playwright test e2e/motion-system.spec.ts --project=mobile-390`

**文件：** `e2e/motion-system.spec.ts`

## 任务 2：增加 motion tokens 与核心入场动画（GREEN）

**验收标准：**

- 环境光、访问门、顶部控制、消息列表、控制坞和输入区具有协调的入场/呼吸动效。
- 只使用原生 CSS，不改变业务逻辑。
- 主界面动效契约通过。

**验证：** 动效 E2E mobile 项目；`npm run test:unit`

**文件：** `src/styles/tokens.css`、`src/styles/chat.css`

## 任务 3：覆盖状态与微交互

**验收标准：**

- 消息、流式状态、图片预览、Toast、状态条、PWA 提示、菜单/历史/LLM 面板具有状态动画。
- 按钮、输入框、列表项、语言切换和确认面板有一致的 hover/focus/active 反馈。
- reduced-motion 契约通过。

**验证：** 动效 E2E mobile/desktop 项目；键盘和触控路径手动检查。

**文件：** `src/styles/chat.css`

## 任务 4：完整验证与审查

**验收标准：**

- 单测、类型检查、Lint、构建、完整 E2E 全绿。
- 390×844、1440×1000 与 320px 窄屏无溢出或遮挡。
- 控制台无错误；正常与 reduced-motion 截图均可读。

**验证：**

- `npm run test:unit`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npx playwright test e2e/motion-system.spec.ts`

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 动效过多影响阅读 | 中 | 环境动画低频低幅，文本本身不循环移动 |
| 模糊和阴影动画影响性能 | 高 | 不动画 `filter`、`backdrop-filter` 或大阴影 |
| 触屏缺少 hover | 中 | 所有关键控件同时提供 `:active` 反馈 |
| CSS 动画影响截图稳定性 | 中 | Playwright 截图统一禁用动画；行为测试读取计算样式 |
| 减少动态效果遗漏 | 高 | 通用 media query 加真实浏览器契约测试 |

## 检查点

- 任务 1 后：确认测试确实红灯。
- 任务 2 后：主界面可运行且单测无回归。
- 任务 3 后：正常/减少动态效果两套浏览器契约通过。
- 任务 4 后：仅在拿到新鲜验证输出后宣称完成。
