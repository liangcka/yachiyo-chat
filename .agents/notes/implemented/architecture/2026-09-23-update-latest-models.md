# 领域契约与服务端 Provider 最新大模型同步

- **状态**: implemented
- **类别**: architecture
- **日期**: 2026-09-23

## 背景与目标

为了保持客户端与边缘函数对主流大模型供应商最新能力的完整支持，系统需要同步各厂商在 2026 年 9 月发布的最新基座与主力模型，包括 OpenAI GPT-6 家族、Anthropic Claude Opus 5.5 / Fable 5.1、Google Gemini 3.8 Flash、阶跃星辰 Step-5 Preview 以及 DeepSeek-V4.1-Flash（统一标识 `deepseek-flash`）。

## 架构契约变更

### 1. 前端领域模型 (`src/domain/llm.ts`)
- **StepFun**: 引入新一代基座 `step-5-preview`，支持文本与视觉原生多模态输入；保持 `step-3.7-flash` 为极速默认模型。
- **DeepSeek**: 引入 `deepseek-flash`（DeepSeek-V4.1-Flash）作为主力与默认模型，具备原生多模态识图支持；保留历史型号 `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 确保向后兼容。
- **OpenAI**: 引入 `gpt-6-luna`、`gpt-6-sol`、`gpt-6-astra`，将默认模型更新为敏捷高效的 `gpt-6-luna`。
- **Claude**: 引入旗舰 `claude-opus-5-5` 与高阶推理 `claude-fable-5-1`；保持 `claude-sonnet-5` 为平衡默认模型。
- **Gemini**: 引入主力模型 `gemini-3.8-flash` 并设为默认模型，全面替代上一代作为新基准。

### 2. 边缘函数白名单 (`functions/_shared/providers/`)
- `registry.ts`：更新 `openaiCompatProviders` 中 stepfun、deepseek、openai 的 `allowedModels`、`imageModels` 与 `defaultModel`。
- `anthropic.ts`：更新 `ALLOWED_MODELS` 包含 `claude-opus-5-5` 与 `claude-fable-5-1`。
- `gemini.ts`：更新 `ALLOWED_MODELS` 包含 `gemini-3.8-flash`，并将 `defaultModel` 设为 `gemini-3.8-flash`。

## 验证与覆盖

- 领域元数据完整性与视觉模型映射测试 (`src/domain/llm.test.ts`)
- 设置面板选型与图片能力提示测试 (`src/components/LlmSettingsPanel.test.tsx`)
- 本地存储与默认回退测试 (`src/services/llm-settings.test.ts`)
- 后端白名单与请求构建测试 (`functions-tests/_shared/providers/registry.test.ts`, `gemini.test.ts`, `anthropic.test.ts`)
