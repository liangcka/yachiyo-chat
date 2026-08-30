# Agent Note: P0-P3 核心性能与健壮性架构重构

Status: implemented

## Problem
在大型长文本聊天、频繁流式 chunk 传输及海量历史消息渲染场景下，前端面临以下瓶颈：
1. **主线程高频重绘卡顿**：流式 delta 与 thought 的高频派发导致全量组件高频 re-render。
2. **DOM 膨胀与内存占用**：长会话无虚拟化，大量 MessageBubble DOM 节点拖慢滚动帧率与内存。
3. **流式正文与历史数组耦合**：每次 chunk 更新均触发不可变消息数组整体拷贝。
4. **Dexie 与原生 IndexedDB 版本换算并发竞态**：测试初始化与应用自愈时存在锁冲突。
5. **动态底部面板布局适配**：在多行 Composer、离线状态栏、PWA 安装提示弹出时消息气泡底部可能被遮挡。

## Decision
落地并全量通过了九项系统性重构改造：
1. **MessageBubble Memo 化与回调稳定**：组件深度 `React.memo`，稳定消息回调引用，阻断无关消息气泡重绘。
2. **rAF 合并高频流式派发**：通过 `requestAnimationFrame` 合并高频 delta/thought 的 emit，对齐浏览器渲染帧率。
3. **App.tsx Blob 缓存依赖优化**：修复 URL Blob 缓存生命周期，避免重复分配与内存泄露。
4. **结构化错误下发与客户端路由**：服务端下发标准结构化错误代码，客户端实现统一捕获与状态展示。
5. **分页加载与定点消息替换**：`listMessages` 支持分页机制，`replaceMessages` 支持批量/定点更新。
6. **流式正文与 messages 数组解耦**：流式生成中的正文在专有 state 中流转，生成完毕后再固化进消息持久化仓库。
7. **虚拟列表接入**：引入 `@tanstack/react-virtual` 实现全量消息列表视口窗口化，支持海量历史平滑滚动。
8. **GitHub Actions CI 与 ESLint 治理**：建立全量 CI 检查，消除存量 lint 错误与类型隐患。
9. **独立性能测试基准与底部动态安全边距**：
   - 建立 `npm run test:perf`（120条长文本消息虚拟化性能与长任务防线）。
   - 在 `App.tsx` 为 `.chat-bottom` 挂载 `ResizeObserver` 动态注入 `--chat-bottom-height` CSS 变量，确保主对话区底端气泡在任何弹出面板状态下均保持安全间距（20px~36px）。

## Alternatives considered
- **全量原生滚动不加虚拟化**：开发成本低，但当会话消息超过 50 条时滚动掉帧明显，低端移动设备及低性能浏览器内存激增。
- **自定义手写虚拟列表**：容易引入边界计算缺陷与无障碍（a11y）兼容性问题，最终采用成熟稳定的 `@tanstack/react-virtual`。

## Consequences
- **收益**：长文本流式生成帧率稳定在 60fps，海量历史消息滚动无卡顿，无障碍树（Accessibility Tree）完全兼容 Playwright 与读屏工具。
- **代价**：虚拟化容器不能标记 `aria-hidden="true"`，且需要精确管理动态高度估算与尺寸监听。

## Verification
全量基线全部验证通过：
- `npm run typecheck`：0 error
- `npm run lint`：0 error
- `npm run test:unit`：203/203 passed
- `npm run test:functions`：180/180 passed
- `npm run test:perf`：1/1 passed
- `npm run test:e2e`：27 passed
