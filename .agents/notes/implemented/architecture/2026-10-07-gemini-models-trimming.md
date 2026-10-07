# Gemini 支持模型精简至官方三档主力矩阵

- **状态**: implemented
- **类别**: architecture
- **日期**: 2026-10-07

## 背景与目标

Google Gemini 系列在交互层完成代际收拢，主推三个定位清晰的核心梯度：
- **3.5 Flash-Lite** (`gemini-3.5-flash-lite`)：极速问答与低延迟交互。
- **3.8 Flash** (`gemini-3.8-flash`)：全方位主力模型，推荐基准。
- **3.1 Pro** (`gemini-3.1-pro`)：高阶推理与复杂逻辑。

为避免过时中间过渡型号（如 3.5-flash、3.6-flash、3.7-flash、3.1-flash-lite 等）造成选型混淆，Yachiyo Chat 前后端模型配置收敛至官方此三款主力模型。

## 架构契约变更

### 1. 前端领域模型 (`src/domain/llm.ts`)
- `PROVIDER_METADATA.gemini.models` 精简为：`gemini-3.5-flash-lite`、`gemini-3.8-flash`、`gemini-3.1-pro`。
- `imageModels` 保持与支持列表一致（三款模型皆支持多模态识图）。
- 保持 `gemini-3.8-flash` 为默认与推荐模型。

### 2. 边缘函数白名单 (`functions/_shared/providers/gemini.ts`)
- `ALLOWED_MODELS` 同步收敛至 `gemini-3.5-flash-lite`、`gemini-3.8-flash` 与 `gemini-3.1-pro`。

### 3. 设置面板回退防护 (`src/components/LlmSettingsPanel.tsx`)
- 当本地存储中残留已废弃的历史模型标识时，面板初始化及厂商切换逻辑自动回退至 `meta.defaultModel`，保障界面状态一致性。

## 验证与覆盖

- `npm run typecheck`：通过严格类型校验。
- `npm run test:functions`：通过边缘函数 Provider 适配与测试。
- `npm run test:unit`：通过模型格式化、面板渲染及存储逻辑测试。
- `npm run lint`：符合代码规范与静态检查。
