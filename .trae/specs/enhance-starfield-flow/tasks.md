# Tasks

- [x] Task 1: 扩展 Star 数据结构以支持流动渲染
  - [x] SubTask 1.1: 在 `Star` 接口新增 `vx`、`vy`、`z`（深度 0..1）字段
  - [x] SubTask 1.2: 在 `seedStars` 中基于 `random` 初始化速度向量与深度，确保远景慢/小、近景快/大
  - [x] SubTask 1.3: 引入整体漂移常量（如 0.02 px/frame 量级）形成统一流向

- [x] Task 2: 重写 draw 循环实现实时流动
  - [x] SubTask 2.1: 每帧基于 `vx`、`vy` 更新 `star.x`、`star.y`（reduced-motion 时跳过）
  - [x] SubTask 2.2: 实现边界回绕（超出画布时从对侧重入）
  - [x] SubTask 2.3: 保留 alpha 闪烁叠加在流动之上
  - [x] SubTask 2.4: 根据深度 `z` 调整半径与亮度，强化视差感
  - [x] SubTask 2.5: 确保循环内不分配新对象（复用 star 引用）

- [x] Task 3: 保留既有的可访问性与生命周期行为
  - [x] SubTask 3.1: 保留 `prefers-reduced-motion` 分支：降级为静态绘制 + 闪烁关闭
  - [x] SubTask 3.2: 保留 `visibilitychange` 暂停/恢复逻辑
  - [x] SubTask 3.3: 保留 DPR 适配与 resize 监听（resize 时重新 seed）
  - [x] SubTask 3.4: 卸载时正确取消 RAF

- [x] Task 4: 更新测试用例覆盖流动行为
  - [x] SubTask 4.1: 保留现有断言（clearRect / arc / requestAnimationFrame / cancelAnimationFrame）
  - [x] SubTask 4.2: 新增断言：多次 RAF 回调后星星位置发生变化（验证流动）
  - [x] SubTask 4.3: 新增断言：reduced-motion 时星星位置保持不变
  - [x] SubTask 4.4: 新增断言：边界回绕后星星仍在画布范围内

- [x] Task 5: 验证 UI 未被破坏
  - [x] SubTask 5.1: 确认 `<StarfieldCanvas />` 在 `App.tsx` 调用方式未变
  - [x] SubTask 5.2: 确认 `.starfield` CSS 规则未变
  - [x] SubTask 5.3: 运行 `npm run test`、`npm run lint`、`npm run build` 全部通过

# Task Dependencies
- Task 2 依赖 Task 1（数据结构先于 draw 逻辑）
- Task 3 与 Task 2 并行（生命周期分支在 draw 内部交织）
- Task 4 依赖 Task 1 + Task 2 + Task 3 完成
- Task 5 依赖 Task 4 完成
