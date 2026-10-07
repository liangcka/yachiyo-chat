# Agent Note: 移动端软键盘输入交互与视口动态自适应优化

Status: implemented

## Problem
在移动端（手机浏览器与 Capacitor Android 原生应用）使用虚拟键盘输入时，存在以下交互与布局缺陷：
1. **输入法弹起遮挡最新消息**：当软键盘唤起压缩 `visualViewport` 导致聊天视口变矮时，由于输入法展开动画异步耗时，初始瞬时滚动校准失效后未在视口稳定阶段二次跟进，导致最新消息气泡滞留在视口顶部或被底部输入框覆压遮盖。
2. **四格控制栏霸占宝贵纵向空间**：在键盘展开、纵向视口被削减逾半的情况下，四格小组件（`ControlDock`，包含设置、表情、语音等快捷入口）仍保持全展开状态，不仅侵占约 80px 高度，还会直接叠在历史消息文本上方造成视觉冲突。
3. **底部安全边距冗余**：虚拟键盘已垫起屏幕物理下边缘，但底栏若继续应用 `var(--safe-bottom)`，会在输入框与键盘之间产生多余留白缝隙。
4. **移动端滚动无键盘收起手势**：用户在聊天列表中向上或向下滑动翻看历史记录时，软键盘无法随轻扫手势自动失去焦点收回，阻碍消息完整阅读。

## Decision
构建了移动端软键盘状态感知、底栏智能折叠、视口贴底校准与手势收起的完整闭环机制：

1. **软键盘状态全生命周期感知 (`MobileLayout`)**：
   - 监听 `window.visualViewport` 的 `resize`、`scroll` 及 `orientationchange` 事件，跟踪各屏幕方向的基准最大视口高度。
   - 当视口高度因输入法展开缩减超过 120px 时，识别为软键盘弹起状态，并向根节点赋予 `.keyboard-open` 状态类；收起时精准还原。
2. **打字与键盘展开时 ControlDock 智能收缩**：
   - 当检测到键盘弹起（`isKeyboardOpen`）或输入框获得焦点（`isFocused`）且当前会话存在消息时，自动收缩折叠四格小组件（`isDockCollapsed = true`）。
   - 折叠后底栏高度由 ~140px 缩减至 ~60px，将宝贵视野完整释放给聊天消息流。
   - 键盘弹起时，底部占位 spacer（`--chat-bottom-height`）以实际折叠高度为准，消除冗余留白；而在用户手动上滑浏览历史时维持展开高度占位，避免列表视口颠簸。
3. **多阶段与 ResizeObserver 视口贴底校准**：
   - 在 `ConversationView` 中通过 `ResizeObserver` 监听自身视口容器高度变化：每当输入法弹起或多行文本导致容器尺寸变动时，若用户处于底部或输入框处于激活状态，自动无损触发贴底滚动。
   - 在 `Composer` 的 `onFocus` 阶段，采用多阶段定时器与 `requestAnimationFrame` 递进覆盖不同安卓机型的输入法弹出动画时长，确保键盘完全展开后最新消息稳稳停留在输入框正上方。
4. **移动端触屏滑动手势收起键盘 (`ConversationView`)**：
   - 在触屏设备（`(pointer: coarse)`）或键盘弹起模式下，用户滑动消息列表（`handleTouchMove`、`handleScroll` 超过阈值）或点击列表背景时，主动触发输入元素 `blur()`，顺畅收起键盘，恢复全屏浏览。
5. **键盘弹起时消除安全区冗余 padding (`chat.css`)**：
   - 当 `.keyboard-open` 生效时，`.chat-bottom` 的 `padding-bottom` 自动收敛为 `0.65rem`，使输入框紧贴软键盘上沿。

## Alternatives considered
- **仅依靠输入框聚焦的固定延时滚动**：各品牌手机（小米、华为、OPPO、vivo、Pixel 等）键盘弹起动画从 150ms 至 350ms 不等，单次延时无法适配差异机型，易产生跳动或滚不到底。采用 ResizeObserver + 多阶段递进可兼顾各端。
- **键盘弹起时强制隐藏整块输入栏以外的所有内容**：会打断用户在查看上文时进行回复的连续性。采用仅折叠 ControlDock 并保留消息流贴底的方式视觉体验最自然。

## Consequences
- **收益**：
  - 手机端键盘弹起时视口空间提升约 80px，最新消息气泡完整居于输入框上方，绝无遮挡。
  - 用户轻划列表即可平滑收起软键盘，契合移动端主流即时通讯应用的直觉手感。
  - 彻底消除了输入框与虚拟键盘之间的无谓缝隙。
- **代价**：
  - `MobileLayout` 与 `ConversationView` 增加了轻量状态与观察者逻辑，已通过规范的生命周期清理函数确保组件卸载无泄漏。

## Verification
- `npm run typecheck`：通过（覆盖三份 tsconfig，0 errors）
- `npm run lint`：通过（0 errors, 0 warnings）
- `npm run test:unit`：27 个测试文件、269 个测试用例全部通过（包含新增的焦点折叠与手势收起测试）
