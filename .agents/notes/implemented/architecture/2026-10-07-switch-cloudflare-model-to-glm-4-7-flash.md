# Agent Note: Cloudflare 服务端内置模型迁移至智谱 GLM-4.7-Flash

Status: implemented

## Problem
在 Cloudflare Pages 边缘服务架构中，未配置个人 API Key 的受邀用户请求走服务端默认 fallback 路径。此前服务端默认模型为阶跃星辰（`step-3.7-flash`）。随着智谱新一代高性价比推理基座 `glm-4.7-flash` 的发布，需要将服务端的边缘默认模型体系无缝迁移至智谱 GLM-4.7-Flash，并保持全链路生命周期安全、思维链（Thinking）流式解析与图片保护逻辑的一致性。

## Decision
1. **服务端环境配置切换与严格防御性解析**：
   - 更新 `wrangler.jsonc` 环境变量为 `GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4"` 与 `GLM_MODEL: "glm-4.7-flash"`；
   - 更新 `types/functions.d.ts`、`.dev.vars.example` 与测试配置中的 Secret 变量定义（`GLM_API_KEY`、`GLM_BASE_URL`、`GLM_MODEL`）；
   - 在 `functions/_shared/glm.ts` 中实现 `resolveGlmConfiguration`，对协议、域名（`open.bigmodel.cn`）、路径（`/api/paas/v4`）与模型精确校验。
2. **复用已验证的 OpenAI 兼容 Provider 适配器（DRY 原则）**：
   - 在 `requestGlm` 与搜索意图判断（`judgeSearchNeed`）中直接复用 `getProvider("glm")`；
   - 自动适配智谱 `thinking: { type: "enabled" }` 协议与 `temperature: 0.8` 角色扮演采样优化；
   - 响应端通过 `proxyProviderStream` 与 `extractDeltaText` 保证思考内容与正文流式输出给前端。
3. **多模态与纯文本能力隔离保护**：
   - 智谱 `glm-4.7-flash` 为纯文本推理模型，不支持图片输入；
   - 服务端 `handleServerFallback` 增加图片请求拦截，若包含图片则返回 400 `INVALID_REQUEST`；
   - 前端默认状态下根据 `PROVIDER_METADATA["glm"].imageModels` 精确计算图片支持状态，禁用拍摄与粘贴，并向用户提供友好提示。
4. **前端模型矩阵镜像同步**：
   - 在 `src/domain/llm.ts` 中将 `glm-4.7-flash` 纳入智谱可选模型列表；
   - 更新 `use-chat-controller.ts` 中未配置自定义 Key 时的默认落库厂商与模型为 `glm` / `glm-4.7-flash`。

## Alternatives considered
- **保留 StepFun 独立网络请求模块与双重维护**：由于智谱与 StepFun 均遵循 OpenAI 兼容 SSE 协议，且项目已有标准化 Provider 体系，直接复用 Provider 机制能够消除冗余代码与维护成本。

## Consequences
- **收益**：Cloudflare 服务端开箱即用体验升级为具备高推理能力的 GLM-4.7-Flash，思考过程流式透传，参数校验完备防御。
- **影响范围**：`wrangler.jsonc`、`types/functions.d.ts`、`functions/_shared/glm.ts`、`functions/api/chat.ts`、`src/domain/llm.ts`、`src/app/use-chat-controller.ts`、`src/App.tsx`、`README.md`。

## Verification
- `npm run typecheck`：通过（覆盖三份 tsconfig）
- `npm run lint`：通过
- `npm run test:unit`：27 个测试文件、269 个用例全部通过
- `functions-tests/` 针对 GLM 配置、请求与聊天流式的端到端测试全部通过
