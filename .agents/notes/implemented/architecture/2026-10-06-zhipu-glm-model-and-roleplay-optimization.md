# Agent Note: 智谱 GLM 模型体系全景升级与角色扮演（Roleplay）专精优化

Status: implemented

## Problem
在与智谱 AI（open.bigmodel.cn）官方 API 对接及角色扮演场景实践中，存在以下模型老旧与体验痛点：
1. **模型体系老旧与关键型号缺失**：
   - 仓库旧配置中仅包含实验性或新一代编号（`glm-5.3`、`glm-4.7-flash` 等），完全缺失了智谱在真实社区生态中最核心的通用旗舰 `glm-4-plus`、极速免费款 `glm-4-flash` / `glm-4-flashx`、超长文本 `glm-4-long`，以及主力视觉旗舰 `glm-4v-plus` / `glm-4v`。
   - **角色扮演专属模型缺失**：智谱官方专门针对拟人化对话、情感陪伴、长多轮人设记忆优化的垂直模型 `charglm-4`（1元/M Tokens）在列表中缺失，导致用户无法一键选用社区公认性价比最高、拟人表现最自然的 RP 模型。
2. **Thinking 参数未区分模型引发报错风险**：
   - 智谱新一代模型（GLM-5 系列、GLM-4.7、GLM-4.6、GLM-4.5 等）支持原生 `thinking: { type: "enabled"|"disabled" }` 思考协议；但若向 `charglm-4`、`glm-4-plus`、`glm-4-air`、`glm-4-flash` 等非思考模型传入 `thinking` 字段，智谱 API 会直接抛出 `1210`（参数错误）或 `1212`（当前模型不支持该调用方式）致命异常。
3. **缺少针对角色扮演的采样参数（Temperature）优化**：
   - 智谱 API 严格限定 `temperature` 范围在 `[0.0, 1.0]`，且官方强烈建议不与 `top_p` 同时大幅调节。此前请求未显式配置采样温度。根据社区（SillyTavern 酒馆等）在 GLM 上的最佳实践，`temperature: 0.8` 是角色扮演拟人度与生动度的最优平衡点。

## Decision
1. **全景对齐智谱官方最新模型矩阵与精准核心选型**：
   - 前端模型下拉菜单精准收敛为 4 款核心模型，其余全部剔除：
     - `charglm-4`（角色扮演专精，默认首选推荐，带金黄色「✨ 推荐」徽章，纯文本）；
     - `glm-5.3`（最新一代高智力旗舰基座，支持深度思考 Thinking）；
     - `glm-5.3-flash`（最新一代极速模型，带「识图」标签，支持拍照与图片理解，支持 Thinking）；
     - `glm-4.6v-flash`（4.6f 官方免费视觉推理模型，带翡翠绿「🎁 免费」徽章与「识图」标签）。
   - 服务端 `allowedModels` 保持超集兼容，存量配置平滑无损。
2. **UI 推荐与免费双徽章体系与位置尺寸对齐规范（Visual Badges & Alignment）**：
   - 引入 Lucide `Sparkles`、`Gift` 与 `Eye` 图标：
     - 为首选模型渲染金色高亮「✨ 推荐」徽章；
     - 为免费模型渲染翡翠绿「🎁 免费」徽章；
     - 为视觉模型渲染天青蓝高亮「👁️ 识图」徽章；
   - **绝对位置对齐**：采用双栏布局，模型名称靠左截断，所有徽章统一放入 `custom-select__badges` 容器中并 `margin-left: auto` 整体右对齐；
   - **绝对尺寸统一**：所有徽章固定高度 `1.35rem`、内边距 `0 0.45rem`、图标尺寸 `11px`，字号 `0.68rem` 居中单行排布，消除视觉不齐；
   - **选中槽位保位（Check Slot）**：每个选项预留固定宽度 `1.15rem` 的 Check 图标槽位，无论是否被选中，徽章右边缘全部在同一条竖直线上严格对齐。
   - 明确标注 `charglm-4` 为文本专精角色模型（不支持识图）；如需发图与多模态交互，可直接切换为支持视觉的 `glm-5.3-flash` 或完全免费的 `glm-4.6v-flash`。
3. **按模型能力分流的 GLM Thinking 协议支持**：
   - 在 `OpenAICompatConfig` 中引入 `glmThinking?: boolean` 开关。
   - 实现 `isGlmThinkingModel` 识别器：精确判定前缀为 `glm-5`、`glm-4.7`、`glm-4.6`、`glm-4.5` 的推理基座。
   - 仅对支持思考的模型在聊天时注入 `thinking: { type: "enabled" }` 与 `reasoning_effort`，常规对话与角色扮演专精模型（`charglm-4`、`glm-4-plus` 等）坚决不带 `thinking` 字段，杜绝 `1210`/`1212` 报错。
   - 在搜索意图判断（judge）请求中，对思考模型自动压低推理负载（`reasoning_effort: "low"`），并固定 `temperature: 0.1` 确保输出一致性。
4. **角色扮演专精采样调优（Roleplay Temperature Tuning）**：
   - 在智谱配置中注入 `defaultTemperature: 0.8`。在聊天生成中保持 `[0.0, 1.0]` 合规区间内的最优创造力与情感灵动度，符合社区广泛推崇的 RP 参数设置。

## Alternatives considered
- **对所有智谱模型统一注入 thinking 字段**：实测与官方规范确认，向 `charglm-4` 或 `glm-4-flash` 传入 `thinking` 会导致请求直接报错拒绝，必须按模型族系进行能力分流。
- **沿用通用 1.0 以上温度**：智谱 API 对超出 `1.0` 的 temperature 强校验报错，且社区经验表明 0.8 在保持人设稳定性的同时最具拟人对话温度。

## Consequences
- **收益**：智谱全系模型（RP 专精、通用旗舰、免费极速、视觉多模态、深度思考）完整可用，默认模型 `charglm-4` 带来高度拟人、富有人情味的角色扮演体验，思考模型自动兼容折叠展示，杜绝 API 参数冲突报错；模型选择器所有徽章右对齐排布、尺寸统一、质感协调。
- **影响范围**：`src/domain/llm.ts`、`src/components/LlmSettingsPanel.tsx`、`src/styles/chat.css`、`functions/_shared/providers/registry.ts`、`functions/_shared/providers/openai-compat.ts`。

## Verification
- `npm run typecheck`：通过（覆盖三份 tsconfig）
- `npm run lint`：通过
- `npm run test:unit`：25 模块全部通过（240/240 passed）
- `npm run test:functions`：22 模块全部通过（276/276 passed）
