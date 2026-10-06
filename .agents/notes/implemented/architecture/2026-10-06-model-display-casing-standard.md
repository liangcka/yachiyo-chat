# Agent Note: 前端模型名称显示大小写规范化（Model Display Casing Standard）

Status: implemented

## Problem
在前端 LLM 厂商与模型选择面板（`LlmSettingsPanel`）中，模型名称原先使用了 CSS 强制全小写转换（`text-transform: lowercase`），导致所有厂商的模型均以全小写展示。这造成以下体验问题：
1. **厂商专有缩写失真**：智谱大模型品牌核心缩写 `GLM`（如 `GLM-5.3`、`charGLM-4`）被全小写为 `glm-5.3`、`charglm-4`，丧失了品牌标识度；
2. **专有名词首字母未大写**：Google 的 `Gemini` 与 Anthropic 的 `Claude` 系列作为专有名称，在展示时未大写首字母（如 `gemini-3.8-flash`、`claude-sonnet-5`）；
3. **缺少统一的显示格式化层**：如果直接变更底层 `models` 数组字符串，由于 Google Gemini 与 Anthropic 等官方 API 端点与载荷对模型 ID 字符串区分大小写，直接修改模型 ID 会引发上游 API 报 404 / 400 错误。

## Decision
1. **解耦显示格式与底层 API 契约**：
   - 底层 API 契约、IndexedDB 存储与后端请求参数继续保持官方标准的 kebab-case 小写标识符（`gemini-3.8-flash`、`claude-sonnet-5`、`glm-5.3`、`charglm-4`、`step-3.7-flash`、`gpt-6-luna` 等），确保 100% 协议兼容与安全；
   - 在 `src/domain/llm.ts` 中提供统一纯函数 `formatModelDisplayName(model: string): string`，负责视觉呈现层的大小写转换。
2. **严格落地模型大小写规范与最新生态收敛**：
   - **Claude 模型精准收敛**：仅保留在役三款最新模型：`claude-sonnet-5-5`（默认/推荐）、`claude-opus-5-5`、`claude-haiku-5`，移除其他旧版；UI 格式化展示为 `Claude-sonnet-5-5`、`Claude-opus-5-5`、`Claude-haiku-5`；
   - **GPT 系列保留 5.6 至 6 上限**：纳入最新发布的 `gpt-6-astra`、`gpt-6.1-sol`、`gpt-6-sol`、`gpt-6-luna`，以及继续全量支持且未被弃用的 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`；剔除 5.5 及 4.1 等老旧型号；
   - **GLM 全大写**：如 `GLM-5.3`、`GLM-5.3-flash`、`GLM-4.6v-flash`，以及角色扮演专精模型 `charGLM-4`；
   - **Gemini 首字母大写**：如 `Gemini-3.8-flash`、`Gemini-3.7-flash`、`Gemini-3.1-pro` 等；
   - **GPT 保持全大写**：如 `GPT-6-astra`、`GPT-6.1-sol`、`GPT-6-luna`、`GPT-5.6-sol` 等；
   - **step 保持全小写**：如 `step-5-preview`、`step-3.7-flash` 等；
   - **其他模型（如 deepseek）及后缀一律全小写**：如 `deepseek-flash`、`deepseek-v4-pro`。
3. **移除 CSS 强制 lowercase**：
   - 从 `src/styles/chat.css` 的 `.custom-select__model-name` 中移除 `text-transform: lowercase;`，让格式化后的真实大小写完整自然地渲染至界面。

## Alternatives considered
- **直接修改前后端 models 列表中的字符串**：Anthropic、Google Gemini、智谱等上游 API 严格校验模型名参数大小写，大写模型名会直接造成 API 报错 404/400；故必须在前端展示层解耦格式化。
- **纯 CSS 大写转换**：CSS 无法区分针对不同模型前缀的复杂逻辑（如 charGLM 混合大小写、gpt 强制小写、Gemini 首字母大写）。

## Consequences
- **收益**：模型设置面板各模型名称优雅且符合业界规范（`GLM-5.3`、`charGLM-4`、`Claude-sonnet-5`、`Gemini-3.8-flash`、`gpt-6-luna`、`step-3.7-flash`、`deepseek-flash`）；前后端契约与 API 零破坏、零风险。
- **影响范围**：`src/domain/llm.ts`、`src/domain/llm.test.ts`、`src/components/LlmSettingsPanel.tsx`、`src/components/LlmSettingsPanel.test.tsx`、`src/styles/chat.css`。

## Verification
- `npm run test:unit`
- `npm run test:functions`
- `npm run typecheck`
- `npm run lint`
