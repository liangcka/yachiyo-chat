# Agent Note: 对话质感提示词升级与 DeepSeek 思考档位、采样及厂商分支专项调优

Status: implemented

## Problem
角色扮演体验与 DeepSeek 接入各自存在两类顽固退化：

1. **模板腔残留（AI味）**：既有提示词只给出「严禁公文腔」的抽象禁令与少量黑名单词，模型仍能绕过词面产出同构的模板句式——复述用户原话开场、「共情→分析→建议→鼓励」安慰四段式、结尾升华道理、每条以「你觉得呢」反问收尾、连续多条用同一种括号神态起头。缺少可对照执行的句式级禁令与正反改写示范，禁令无法落地。
2. **只被动应答（缺少情绪深度与主动性）**：原提示词通篇约束「如何回应」，从未授权角色主动推进对话。表现为八千代只当回声：不分享自身近况、不调用已注入的长期记忆、不提议、不追问，且倾向给出理智正确但情感冷淡的回答（在彩叶难过时讲道理、给方案），与「同居伴侣」的关系设定脱节。
3. **DeepSeek 思考档位与场景错配**：`buildOpenAICompatBody` 对所有 DeepSeek 聊天请求固定注入 `thinking: enabled` + `reasoning_effort: "high"`（含图片时 `"medium"`）。本应用的主要负载是 15~50 字即时消息，思考 token 先于正文生成，档位直接决定首字延迟，为日常闲聊付最高档思考代价既慢又无收益；`summary` 模式的记忆压缩同样吃高档思考，而它阻塞在发信之前、延迟对用户直接可感。
4. **DeepSeek 采样参数缺省**：DeepSeek 是四个 OpenAI 兼容厂商中唯一未显式配置采样参数的 provider（GLM 已按角色扮演实践注入 `temperature: 0.8`）。长对话中 DeepSeek 存在句式趋同与复读倾向，缺少重复惩罚。
5. **无厂商专属提示词通道**：`buildSystemPrompt` 对所有厂商输出同一份 runtime 指令，无法针对某一厂商已确认的输出倾向做定向收紧。

## Decision
1. **角色提示词：句式级禁令 + 正反改写示范 + 情绪优先原则**（`角色提示词.txt`）
   - 在「真人交流感（拒绝AI味）」下新增「句式禁令」子节，把抽象的「拒绝AI味」拆成 5 条可判定的句式规则（禁复读开场、禁安慰四段式、禁结尾升华与反问收尾、禁未征询的建议清单、禁连续同构起头），并给出 3 组 ✗/✓ 改写示范。示范句写在指令区而非「语料库」，语料库保持为纯原作台词，不掺入虚构内容。
   - 新增「情绪优先于正确」：她难过、委屈、生气时先无条件站在她这边，道理与方案等她主动问再说；理智正确但情感冷淡的回应一律判定为失败回应。
2. **角色提示词：新增「主动性与自我（拒绝只当回声）」小节**
   - 授权自我暴露（分享此刻在做什么、旧事、小抱怨、小得意，可突然撒娇或翻旧账）；
   - 授权主动调用【前情提要】与【关于彩叶的长期记忆】中的具体细节，同时明确「只能引用注入记忆中确实存在的内容，严禁编造共同回忆」，避免主动性反向催生虚假记忆；
   - 「钩子」机制：接话后尽量留一个追问、提议或自身感想，但每条最多一个，禁止连环发问；对方想安静或明显疲惫时安静陪着即可；
   - 允许不同意、允许有小脾气，达观体现在看事情的角度与分寸而非永远心平气和。
3. **runtime 尾部复述关键质感约束**（`functions/_shared/prompt.ts`）
   - 新增 `vividnessInstruction`（中日双语），以压缩形态复述句式禁令、情绪优先与主动性要点，插入位置在 `memoryTrustInstruction` 之后、`outputRule` 之前。
   - 与角色提示词正文同源属有意冗余：长上下文与长历史会稀释靠前的设定权重，这两类退化又是历史反馈中最顽固的问题，需要在 runtime 尾部借助近因权重再压一次。
4. **厂商专属提示词通道**
   - `SystemPromptOptions` 新增 `provider?: ProviderId`；新增 `providerInstruction: Partial<Record<ProviderId, Record<ChatLocale, string>>>`，命中时作为 runtime 块最后一行追加。
   - 目前仅 `deepseek` 有条目，针对其已知倾向定向收紧：不展开解释、不分点罗列、不加小标题、不列行动建议清单、不结尾总结升华、不用「你说……确实……」复读开场，并明确「这是手机即时消息，不是问答题：绝大多数时候一两句话就该结束，宁可短也不要凑内容」。
   - 未列入映射的厂商行为完全不变；`summary` 模式走记忆整理提示词，不受 `provider` 影响。
5. **DeepSeek 思考档位场景阶梯**（`functions/_shared/providers/openai-compat.ts`）
   - 新增导出的 `resolveDeepSeekReasoningEffort(model, request, containsImage)`：
     - `summary` 模式固定 `"low"`；
     - 深度信号 = 含图片 或 开启联网搜索 或 最近一条用户消息 ≥ 120 个 Unicode 码点；
     - 无深度信号时：`deepseek-v4-pro` → `"medium"`，`deepseek-flash` → `"low"`；
     - 有深度信号时：`deepseek-v4-pro` → `"high"`，`deepseek-flash` → `"medium"`。
   - 消息长度按 Unicode 码点（`[...text].length`）计数，避免 emoji 等代理对被 UTF-16 单元数放大一倍而误升档。
   - 智谱 GLM 思考模型的档位保持原状（`"high"`，含图片 `"medium"`），不复用 DeepSeek 阶梯。
6. **DeepSeek 采样参数**
   - `OpenAICompatBehavior` 新增 `defaultFrequencyPenalty?: number`，请求体据此注入 `frequency_penalty`；注册表中 DeepSeek 配置为 `defaultTemperature: 1.0`（官方会话推荐值，范围 `[0, 2]`）与 `defaultFrequencyPenalty: 0.3`（官方建议的重复抑制档位，过高会导致语言混杂）。
   - `buildJudgeRequest` 不注入 `frequency_penalty`：搜索意图判定要求确定性输出，重复惩罚会扰动 YES/NO 判定；judge 仍保持 `thinking: disabled` + `reasoning_effort: "low"` + `temperature: 0.1`。
7. **请求体构造签名收敛**
   - `buildOpenAICompatBody(request, model, supportsImage, reasoningEffort, deepseekThinking, glmThinking, defaultTemperature)` 的 7 个位置参数收敛为 `buildOpenAICompatBody(request, model, options: OpenAICompatBodyOptions)`。
   - 抽出 `OpenAICompatBehavior` 承载行为开关与采样配置，`OpenAICompatConfig`（追加 endpoint / 模型白名单 / imageModels）与 `OpenAICompatBodyOptions`（追加 provider）共同继承它，避免两处字段漂移。

## Alternatives considered
- **只在角色提示词正文里加规则，不在 runtime 尾部复述**：正文位于系统提示词最前端，在 20 条历史消息 + 长期记忆 + 搜索结果的实际负载下权重明显衰减，而这恰恰是模板腔最容易复发的场景。接受有意的同源冗余换取约束强度。
- **把 ✗/✓ 改写示范写进「语料库」**：语料库在提示词中自我声明为「原作经典台词」，掺入虚构句会污染其权威性，也可能被模型当作设定事实引用。示范句一律放在指令区。
- **主动性示例引用具体偏好（如「你不是最讨厌青椒嘛」）**：具体细节会被模型固化为既定事实并反复引用，形成凭空捏造的人设。改为不带具体内容的通用示例，并显式禁止编造共同回忆。
- **DeepSeek 与 GLM 共用同一套思考档位阶梯**：GLM 思考模型的档位由 2026-10-06 的智谱角色扮演专项调优确定，在缺少 DeepSeek 侧同等实测依据的情况下同步下调属于无根据的行为变更，两套阶梯独立保留。
- **给所有 OpenAI 兼容厂商统一注入 `frequency_penalty`**：阶跃星辰与 OpenAI 侧没有观测到复读问题，无差别注入只会增加不可控的采样偏移；按厂商在注册表中显式声明。
- **用请求体里的 `request.provider` 决定厂商分支**：服务端存在未指定 provider 的回退路径，该字段可为 `undefined`；适配器自身的 `id` 才是承接生成的权威来源。

## Consequences
- **收益**：
  - 模板腔从「抽象禁令」变为可逐条判定的句式规则并配正反示范，同时 runtime 尾部复述，约束在长上下文中不再衰减；
  - 角色获得明确的主动授权与边界（每条最多一个钩子、禁编造回忆），在提升情绪深度的同时不失控为连环发问；
  - DeepSeek 日常闲聊思考档位由 `high` 降至 `low`，首字延迟与思考 token 开销显著下降；深度提问、联网、识图与 `deepseek-v4-pro` 仍按需升档，推理能力不被一刀切削弱；
  - `summary` 记忆压缩不再吃高档思考，阻塞式压缩的可感延迟下降；
  - DeepSeek 长对话复读与句式趋同获得采样层抑制；
  - 厂商专属提示词通道成为通用 seam，后续厂商出现顽固倾向时只需在 `providerInstruction` 增条目。
- **代价与注意事项**：
  - 角色提示词正文增长约 1.4KB，系统提示词总长相应增加；
  - `vividnessInstruction` 与正文存在有意冗余，后续修改「真人交流感」或「主动性与自我」条款时必须同步更新两处，否则会出现规则打架；
  - DeepSeek `reasoning_effort` 档位下调后，若观测到复杂提问回应质量下降，调整点是 `DEEP_TOPIC_CODE_POINTS`（当前 120）与 `DEEPSEEK_HIGH_TIER_MODELS`，不要直接改回固定高档；
  - `buildOpenAICompatBody` 签名变更属破坏性改动，调用方与测试须使用 options 对象。
- **影响范围**：`角色提示词.txt`、`functions/_generated/role-prompt.ts`（由 `npm run sync:prompt` 生成）、`functions/_shared/prompt.ts`、`functions/_shared/providers/openai-compat.ts`、`functions/_shared/providers/registry.ts`、`functions-tests/_shared/prompt.test.ts`、`functions-tests/_shared/providers/openai-compat.test.ts`、`functions-tests/_shared/providers/registry.test.ts`。前端未改动。

## Verification
- `npm run sync:prompt`：已执行，`functions/_generated/role-prompt.ts` 与根提示词一致
- `npm run typecheck`：通过（覆盖 app / node / functions 三份 tsconfig，0 error）
- `npm run lint`：通过（0 error，0 warning）
- `npm run test:functions`：通过（22 文件，285 测试全部通过；新增 9 条覆盖思考档位阶梯、码点计数、厂商分支注入与采样参数）
- `npm run test:unit`：通过（25 文件，254 测试全部通过；前端未触及，作为基线回归）
