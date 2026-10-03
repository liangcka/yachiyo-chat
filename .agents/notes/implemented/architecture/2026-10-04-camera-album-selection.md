# Agent Note: 拍摄按钮交互扩展（相机与相册选择菜单）

Status: implemented

## Problem
右上角的“拍摄”按钮此前直接绑定单一带有 `capture="environment"` 的文件输入控件。在移动端或浏览器环境中，这会导致直接打开后置摄像头，用户无法选择直接从手机本地相册挑选已有图片进行识图与对话。

## Decision
1. **交互分流（Camera vs Album Selection Menu）**：
   - 用户点击右上角“拍摄”药丸按钮时，展开带有星空玻璃质感（Starfield Glass UI）与微动效的下拉菜单，提供“相机”与“相册”两个操作项；
   - 菜单支持外部点击（Outside Click）与按 `Escape` 键自动关闭，再次点击拍摄按钮支持收起（Toggle 交互）；
   - 在图片处理中（`processing`）或控件禁用（`disabled`）状态下，自动收起菜单并禁止展开。

2. **双通道输入控件（Dual Input Architecture）**：
   - 保留原有的相机输入控件：`<input type="file" accept="image/*" capture="environment" />`，点击“相机”时触发；
   - 新增独立的相册输入控件：`<input type="file" accept="image/*" />`（不附带 `capture` 属性），点击“相册”时触发，在移动端及 Web 端直接唤起系统相册/文件选择器；
   - 两个控件复用相同的图片解码、压缩（`processImage`）以及重选容错逻辑。

3. **国际化支持（i18n）**：
   - 在 `UiCopy` 中新增 `captureCamera`（中: "相机", 日: "カメラ"）与 `captureAlbum`（中: "相册", 日: "アルバム"）。

## Alternatives considered
- **复用单一 input 动态修改 capture 属性**：
  被否决。部分移动端 WebView 内核在属性动态变更后紧接着调用 `click()` 时存在状态缓存或延迟，导致无法稳定唤起相册。使用双 input 分离是更稳健可靠的无副作用方案。

## Consequences
- **收益**：
  - 用户可在手机端与 Web 端自由切换即时拍照与相册选图；
  - 界面风格与项目整体星空玻璃设计语言保持高度统一。
- **代价**：
  - 增加了下拉菜单 DOM 节点与轻量级点击监听，在组件卸载或关闭时已严格注销监听，无内存泄漏风险。

## Verification
- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:functions`
