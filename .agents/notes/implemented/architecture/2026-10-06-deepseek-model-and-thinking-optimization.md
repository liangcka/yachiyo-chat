# Agent Note: DeepSeek 官方标准模型体系对齐与 Thinking 协议深度优化

Status: implemented

## Problem
在与 DeepSeek 官方 API 规范对接与 UI 交互中存在以下断层与体验痛点：
1. **模型体系与真实可用性**：DeepSeek 官方平台（`api.deepseek.com`）已将历史别名 `deepseek-chat` / `deepseek-reasoner` 于 2026 年 7 月退役下线，并将独立识图实验模型 `deepseek-v4-flash-vision-exp` 及过渡版 `deepseek-v4-flash` 统一收敛至原生自带多模态视觉的 `deepseek-flash`（DeepSeek-V4.1-Flash）。若前端配置旧版退役别名将导致调用失败或冗余。
2. **UI 大小写展示不一致**：此前模型下拉项使用了 `text-transform: uppercase` 强制全大写，与官方小写命名标识符不符。
3. **缺少原生 Thinking 协议控制**：DeepSeek 思考模式通过请求体参数 `thinking: { type: "enabled"|"disabled" }` 与 `reasoning_effort` 进行控制。后端适配器需针对性配置，在主聊天与意图判断中差异化分流。
4. **意图判断（Search Judge）与网络搜索耗时过高**：非流式搜索意图判断（judge）和结构化联网搜索提取若未显式禁用思考模式，模型可能会在生成前进入长思考链，导致 4 秒超时回退或大幅增加首字生成耗时。

## Decision
1. **对齐 DeepSeek 官方当前在役核心模型与视觉约束**：
   - 前后端统一只保留官方最新在役的核心模型：`deepseek-flash`（默认与推荐旗舰模型，原生多模态视觉识图）及 `deepseek-v4-pro`（专业级高推理模型）。
   - 移除已停用退役的旧模型（`deepseek-chat`、`deepseek-reasoner`、`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`）。
   - 由于 `deepseek-flash` 原生支持图片输入，`supportsImage` 声明为 `true`，`imageModels` 配置为 `["deepseek-flash"]`。
   - 官方端点标准化为 `https://api.deepseek.com/chat/completions`。
2. **模型选择器统一样式为小写展示**：
   - 在 `src/styles/chat.css` 中将 `.custom-select__model-name` 的 `text-transform` 设置为 `lowercase`，确保模型下拉框选中态与选项列表均以优雅的小写格式呈现。
3. **协议层支持 DeepSeek Thinking 深度优化**：
   - 在 `OpenAICompatConfig` 中启用 `deepseekThinking?: boolean` 选项。
   - 主聊天请求中：若启用 `deepseekThinking`，自动注入 `thinking: { type: "enabled" }` 以及 `reasoning_effort: "high"`（包含图片输入时智能调整为 `"medium"`），释放深度推理能力。
   - 意图判断请求中：`buildJudgeRequest` 显式注入 `thinking: { type: "disabled" }` 与 `reasoning_effort: "low"`，杜绝意图判断过程中的思考耗时，使其在数百毫秒内极速返回。
4. **联网搜索 Provider 优化**：
   - `DeepSeekWebSearchProvider` 默认搜索模型配置为主力旗舰模型 `deepseek-flash`。
   - 发送结构化网页提取请求时显式注入 `thinking: { type: "disabled" }`，避免搜索结果抽取被思维链阻塞，保障联网搜索速度与准确率。

## Alternatives considered
- **保留已退役别名**：官方已于 2026 年 7 月废弃下线，继续保留会误导用户并引发 API 404/INVALID_REQUEST 报错。
- **保留 uppercase 强制大写**：模型名本身为 kebab-case 小写，大写影响可读性并引起混淆。

## Consequences
- **收益**：DeepSeek 用户配置与调用 100% 真实可用，消除无效模型干扰；UI 模型名显示清晰自然；原生视觉与思考分流性能稳定。
- **影响范围**：`functions/_shared/providers/`、`functions/_shared/web-search/providers/`、`src/domain/llm.ts` 及 `src/styles/chat.css`。

## Verification
- `npm run typecheck`：通过（覆盖前端、node 与 functions 三份 tsconfig）
- `npm run lint`：通过
- `npm run test:unit`：240/240 passed
- `npm run test:functions`：276/276 passed
