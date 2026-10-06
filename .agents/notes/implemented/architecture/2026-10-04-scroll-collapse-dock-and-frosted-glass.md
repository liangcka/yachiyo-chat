# Agent Note: 滚动折叠底部四格小组件与毛玻璃动态背景

Status: implemented

## Problem
在聊天界面中，底部常驻的四格小组件（ControlDock：设置、表情、音量、麦克风）与文字对话框（Composer）占据了较多的垂直屏幕空间。当用户向上滑动浏览长消息或历史对话记录时，透明底栏会导致消息文字与底栏控制按钮产生视觉重叠与干扰，且压缩了阅读视野。

## Decision
1. **滚动与手势感知联动与方向修正（Scroll & Gesture Direction Correction）**：
   - 严格贴合用户认知直觉：**用户往上滑（向上翻看历史消息记录，`scrollTop` 减小）时**触发四格收缩（`dockCollapsed = true`）；**用户往下滑（向下翻看最新消息或滑回底部，`scrollTop` 增大）时**触发展开（`dockCollapsed = false`）；
   - 触底安全检测（`distanceFromBottom <= 32px`）时始终保持/恢复展开；
   - 移动端触摸手势（`onTouchMove`）同步对齐上述方向。

2. **解决消息遮挡与 Flexbox 布局陷阱（Flex-end Overflow & Spacer Architecture）**：
   - 移除 `.message-list` 上的 `justify-content: flex-end`（该属性在内容溢出时会导致浏览器忽略 `padding-bottom`，硬生生将底部的消息压在屏幕最下边缘从而被输入框盖住）；
   - 改用 `.message-list::before` 设置 `flex: 1 1 auto`，在消息少时弹性吸顶实现内容居底，消息多时自然向下排布；
   - 将 `.message-list__end` 升级为具备真实安全高度的占位垫块（Spacer：`height: var(--chat-bottom-height, calc(var(--safe-bottom) + 11.5rem))`），为最后一条消息下方提供足足 184px 的物理留白，彻底保证任何情况下消息绝对不会被底栏遮挡。

3. **纯正苹果 iOS 磨砂毛玻璃材质与 CSS 编译兼容保障（Apple iOS Frosted Glass & Compiler Prefix Hardening）**：
   - **解决负 z-index 伪元素与嵌套滤镜冲突**：原伪元素 `::before` 设置负 `z-index` 或子元素嵌套 `backdrop-filter` 在 Chromium/WebKit 合成器管线中会被判定为局部图层隔离，导致外部同级滚动列表无法被采样模糊。改为将 `backdrop-filter` 作用于主容器 `.chat-bottom--collapsed` 实体层，消除层叠上下文阻断；
   - **规范 CSS 前缀兼容书写顺序**：将 `-webkit-backdrop-filter` 置于标准 `backdrop-filter` 之前，避免 Vite/LightningCSS 编译器在优化合并时覆盖丢弃无前缀标准属性（Chromium 不支持 `-webkit-` 前缀但支持标准属性），彻底激活多平台硬件级高斯模糊；
   - **调优苹果 iOS 原生液态磨砂质感（UIBlurEffect Dark Material）**：
     - 超强高斯磨砂与高饱和散射：`backdrop-filter: blur(32px) saturate(190%)`，彻底打散融化滑入底栏下方的文字与气泡轮廓，字迹完全溶解为朦胧星空雾光；
     - 质感底色：采用 78% 不透明度的深邃星空磨砂底色（`background: rgb(8 19 46 / 78%)`），既透出背景星云冷光，又兼顾极高可读性；
     - 边缘发丝高光：`border-top: 1px solid rgb(255 255 255 / 22%)` 搭配内边缘微光反射 `inset 0 1px 0 rgb(255 255 255 / 16%)`，呈现纯正的苹果玻璃质感。

## Consequences
- **收益**：
  - 浏览聊天历史与长消息时视口空间提升，消息列表阅读体验纯净无遮挡；
  - 动态毛玻璃与星空玻璃拟态设计语言浑然一体，动效平滑高级。
- **代价**：
  - 增加了滚动方向差值检测与轻量级状态通知，通过防抖死区与触底短路逻辑将性能开销压至近乎为零。

## Verification
- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:functions`
