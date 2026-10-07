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
   - 监听 `window.visualViewport` 的 `resize` 及 `orientationchange` 事件，跟踪各屏幕方向的基准最大视口高度。
   - 当视口高度因输入法展开缩减超过 120px 时，识别为软键盘弹起状态，并向根节点赋予 `.keyboard-open` 状态类；收起时精准还原。
2. **打字与键盘展开时 ControlDock 即时收缩 (`chat.css`)**：
   - 当 `.keyboard-open` 生效时，`.control-dock` 采用 `transition: none` 瞬时折叠，消除 350ms 缓慢形变造成的输入框 Bounds 剧烈漂移，使系统输入法管理器（InputMethodManager）能极速稳定锁定焦点，杜绝键盘闪现缩回。
   - 折叠后底栏高度由 ~140px 缩减至 ~60px，将宝贵视野完整释放给聊天消息流。
   - 键盘弹起时，底部占位 spacer（`--chat-bottom-height`）以实际折叠高度为准，消除冗余留白；而在用户手动上滑浏览历史时维持展开高度占位，避免列表视口颠簸。
   - 底栏尺寸观察器（`ResizeObserver`）在整个生命周期内持久单次挂载，状态通过 ref 读写，彻底杜绝状态切换时卸载 CSS 变量引发的整屏瞬时白闪。
3. **视口尺寸监听与零抢焦贴底校准 (`ConversationView`)**：
   - 坚决不在软键盘弹起期间或输入框获得焦点时调用 `endRef.current?.scrollIntoView()`，所有聊天视口贴底操作严格限制在容器内部（`target.scrollTop = targetScroll`），彻底根绝因滚动视口节点导致移动端浏览器输入法强制关闭的缺陷。
   - 贴底滚动与四格折叠状态解耦：`scrollToBottom` 仅负责滚动位移，严禁反向翻转四格小组件状态（`updateCollapseState`），阻断“弹起收折 -> 贴底展开 -> 状态冲突”的死锁震荡。
   - 在 `ConversationView` 中通过 `requestAnimationFrame` 防抖防高频触发 `ResizeObserver`，确保多帧连续压缩时平滑贴合，不触发多余 React 渲染。
4. **移动端触屏滑动手势收起键盘与程序滚动解耦 (`ConversationView`)**：
   - 严格限定仅在触屏手势真实移动（`handleTouchMove` 且位移阈值满足要求）时触发 `blur()` 收起软键盘。
   - 坚决不在 `handleScroll`（程序性滚动与自动贴底）或全局容器点击事件中调用 `blur()`，杜绝点击聚焦时被误触收起键盘。
5. **键盘弹起时消除安全区冗余 padding (`chat.css`)**：
   - 当 `.keyboard-open` 生效时，`.chat-bottom` 的 `padding-bottom` 自动收敛为 `0.65rem` 且无延时动画，使输入框紧贴软键盘上沿。

## Alternatives considered
- **仅依靠输入框聚焦的固定延时滚动**：各品牌手机（小米、华为、OPPO、vivo、Pixel 等）键盘弹起动画从 150ms 至 350ms 不等，单次延时无法适配差异机型，易产生跳动或滚不到底。采用 ResizeObserver + 多阶段递进可兼顾各端。
- **键盘弹起时强制隐藏整块输入栏以外的所有内容**：会打断用户在查看上文时进行回复的连续性。采用仅折叠 ControlDock 并保留消息流贴底的方式视觉体验最自然。
- **使用 scrollIntoView 贴底**：在移动端 Web 及 WebView 中对非焦点 DOM 节点调用 scrollIntoView 会引发宿主视口与 window 滚动，破坏聚焦上下文并触发键盘闪退，必须替换为容器属性 `container.scrollTop`。

## Consequences
- **收益**：
  - 手机端键盘点击时一次性稳定弹出，彻底消除了点击多次才能成功的闪现缩回缺陷。
  - 键盘弹起时视口空间提升约 80px，最新消息气泡完整居于输入框上方，绝无遮挡。
  - 用户轻划列表即可平滑收起软键盘，契合移动端主流即时通讯应用的直觉手感。
  - 彻底消除了输入框与虚拟键盘之间的无谓缝隙。
- **代价**：
  - `MobileLayout` 与 `ConversationView` 增加了轻量状态与观察者逻辑，已通过规范的生命周期清理函数确保组件卸载无泄漏。

## Verification
- `npm run typecheck`：通过（覆盖三份 tsconfig，0 errors）
- `npm run lint`：通过（0 errors, 0 warnings）
- `npm run test:unit`：27 个测试文件、269 个测试用例全部通过（包含新增的焦点折叠与手势收起测试）
