# 星空实时流动效果 Spec

## Why
当前 `StarfieldCanvas` 中的星星位置固定，仅通过 `Math.sin` 调制 alpha 产生闪烁，缺乏"流动"的视觉动感。需要将其升级为实时渲染的流动星空，让画面具备深度与生命感，同时严格保留现有 UI 结构、组件契约与可访问性约束。

## What Changes
- 为每颗星星引入速度向量（vx, vy）与深度层级（z），实现持续漂移与视差感
- 边界回绕：星星离开画布时从对侧重入，保持密度恒定
- 引入轻微的整体方向漂移（缓慢的整体流向），营造"星河"感
- 保留 alpha 闪烁作为细节层动效，叠加在流动之上
- 保留 `prefers-reduced-motion` 降级（降级为静态星空 + 闪烁，不流动）
- 保留 `visibilitychange` 暂停/恢复机制
- 保留 DPR 适配、resize 监听
- **不改动**：组件名 `StarfieldCanvas`、props 接口 `StarfieldCanvasProps`、className `starfield`、`aria-hidden`、CSS 中的 `.starfield` 规则
- **不改动**：`App.tsx` 中 `<StarfieldCanvas />` 的调用方式与位置
- 性能预算：在 220 颗星星上限下保持 60fps（中端设备），单帧 O(n)

## Impact
- Affected specs: 无（项目首次建立 spec）
- Affected code:
  - `src/components/StarfieldCanvas.tsx`（核心重写 draw/seedStars 逻辑）
  - `src/components/StarfieldCanvas.test.tsx`（扩展断言以覆盖流动行为，保持现有契约）
- 不影响：`src/App.tsx`、`src/styles/chat.css`、其他组件

## ADDED Requirements

### Requirement: 实时流动渲染
系统 SHALL 在每一帧基于星星速度向量更新位置，并通过 `requestAnimationFrame` 持续重绘，呈现连续流动的星空效果。

#### Scenario: 正常流动
- **WHEN** 用户进入应用且未启用 reduced-motion
- **THEN** 星星按各自速度向量持续漂移，画面呈现流动感

#### Scenario: 边界回绕
- **WHEN** 某颗星星的坐标超出画布边界
- **THEN** 该星星从对侧重入画布，保持星星总数恒定

#### Scenario: 视差深度
- **WHEN** 渲染流动星空
- **THEN** 不同深度层级的星星以不同速度移动（远景慢、近景快），并搭配不同亮度/半径

### Requirement: 性能预算
系统 SHALL 在 220 颗星星上限下维持 60fps，单帧时间复杂度 O(n)，禁止在循环内分配新对象。

#### Scenario: 中端设备满载
- **WHEN** 画布面积足够大触发 220 颗星星上限
- **THEN** 单帧渲染时间应显著低于 16ms 预算

### Requirement: 可访问性降级
系统 SHALL 在 `prefers-reduced-motion: reduce` 时停止流动，仅保留静态星空（无闪烁、无漂移）。

#### Scenario: 用户启用减少动效
- **WHEN** `matchMedia("(prefers-reduced-motion: reduce)").matches` 为 true
- **THEN** 不调用 `requestAnimationFrame` 循环，仅绘制一次静态星空

### Requirement: 可见性暂停
系统 SHALL 在 `document.hidden` 为 true 时暂停 RAF 循环，并在恢复可见时自动恢复。

#### Scenario: 切换标签页
- **WHEN** 用户切换到其他标签页
- **THEN** 取消 `requestAnimationFrame`；切回时自动恢复流动

## MODIFIED Requirements

### Requirement: StarfieldCanvas 组件契约
`StarfieldCanvas` 组件保留以下对外契约不变：
- 默认导出命名：`StarfieldCanvas`（命名导出）
- Props 接口：`StarfieldCanvasProps { random?: () => number }`
- 渲染输出：`<canvas aria-hidden="true" className="starfield" />`
- 可注入 `random` 用于测试确定性

内部实现（Star 数据结构、draw/seedStars 逻辑）可重写，但需保持测试用例中已断言的最小行为契约：
- 调用 `context.clearRect`
- 调用 `context.arc`
- 调用 `requestAnimationFrame`
- 卸载时调用 `cancelAnimationFrame` 并传入先前返回的 id
