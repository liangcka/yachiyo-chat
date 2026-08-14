# Yachiyo Chat 动效系统规格

日期：2026-07-17

状态：根据用户“添加大量的动画”的直接实施指令，按下列默认假设执行；用户可随时修订

## 1. 目标

在不改变现有聊天功能、布局和深蓝磨砂玻璃视觉方向的前提下，为 Yachiyo Chat 增加一套丰富但克制的动效系统。目标用户仍是手机浏览器中的日常聊天用户；成功体验应当是界面更有生命力、操作反馈更明确，同时不会因为持续运动而妨碍阅读。

## 2. 默认假设

1. “大量”表示覆盖环境、入场、状态和微交互四个层级，而不是让每个元素持续晃动。
2. 现有星空、颜色、尺寸、文案和功能保持不变。
3. 不新增第三方动画依赖；优先使用 CSS `transform`、`opacity` 和现有状态属性。
4. 桌面端、移动端和 `prefers-reduced-motion` 用户都必须得到完整支持。
5. 弹层当前关闭时立即卸载，本次只增加入场动画；退场动画若要可靠实现，需要单独改造挂载状态，不纳入本次范围。

## 3. 技术栈与命令

- React 19、TypeScript、Vite 8、原生 CSS、Playwright、Vitest。
- 开发：`npm run dev:mock`
- 单元测试：`npm run test:unit`
- 动效端到端测试：`npx playwright test e2e/motion-system.spec.ts`
- 类型检查：`npm run typecheck`
- Lint：`npm run lint`
- 构建：`npm run build`

## 4. 项目结构

- `src/styles/tokens.css`：动效时长、缓动和错峰 token。
- `src/styles/chat.css`：环境、入场、状态和微交互动效。
- `src/components/*`：保持现有组件职责；仅在 CSS 无法表达语义时才改 JSX。
- `e2e/motion-system.spec.ts`：正常动效和减少动态效果契约。
- `docs/superpowers/plans/`：本规格对应实施计划。

## 5. 代码风格

跨组件共享的节奏和重复时序必须通过语义 token 复用；少量只服务于单一状态的例外时序可在对应样式中局部定义。持续动画仍需限制在合成友好的属性：

```css
.top-controls {
  animation: motion-rise var(--motion-duration-slow) var(--motion-ease-enter) backwards;
}
```

命名使用 `motion-*`；一次性入场动画按延迟需要使用 `backwards`，避免用 `both` 长期保留恒等 transform；循环动画只用于低频环境光和加载/输入状态。

## 6. 测试策略

- Playwright 读取真实浏览器计算样式，确认主要界面层、消息和弹层确实具有动画。
- Playwright 模拟 `prefers-reduced-motion: reduce`，确认动画和过渡被压缩为一次、近零时长。
- 现有 Vitest 测试证明聊天、历史、设置、图片和 PWA 行为未被改变。
- 在 390×844 与 1440×1000 浏览器项目中检查布局、控制台和截图；额外检查 320px 窄屏。

## 7. 边界

### 始终做到

- 保留键盘焦点可见性、触控尺寸和现有 ARIA 语义。
- 为所有新增动画提供减少动态效果降级。
- 循环环境动画只使用 `transform`/`opacity`，避免持续触发布局。
- 动画不能阻挡点击、滚动或文本选择。

### 需要先询问

- 新增动画依赖、音效、震动反馈。
- 改变组件挂载状态以实现退场动画。
- 改变现有布局、颜色体系或聊天业务逻辑。

### 绝不做

- 用 JavaScript 定时器驱动纯装饰动画。
- 对大面积模糊、宽高或定位做无限循环动画。
- 通过隐藏焦点或降低文本对比度换取视觉效果。

## 8. 成功标准

1. 星空背景具有低频呼吸/漂移层，主聊天内容保持可读。
2. 访问门、顶部控制、消息区、控制坞和输入区形成有节奏的分段入场。
3. 新消息、流式回复、图片预览、状态条、Toast、PWA 提示、菜单抽屉、历史面板和 LLM 面板都有明确状态动画。
4. 可操作按钮、表单、历史条目和语言切换具有 hover、focus-visible 或 active 反馈，触屏按压也可感知。
5. reduced-motion 模式下不存在长时或无限 CSS 动画，星空继续遵循现有静态降级。
6. 单测、类型检查、Lint、构建和动效 E2E 全部通过，浏览器控制台无错误。

## 9. 本次不做

- 不引入 Framer Motion、GSAP 或其他运行时依赖。
- 不重构弹层生命周期来实现退场动画。
- 不改变数据层、接口、文案和角色提示词。
