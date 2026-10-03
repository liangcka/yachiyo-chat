# Agent Note: 现实时态感知（Temporal Awareness）与人类化作息关怀心智

Status: implemented

## Problem
在之前的交互中，八千代存在明显的“机械催睡/复读闹钟”现象：
1. **时段死板触发（Nanny Mode）**：一旦处于深夜或凌晨，模型即把“劝睡”当作刚性任务，无论对方兴致如何、开启何种话题（如深夜兴致勃勃讨论《崩坏3》、分享日常等），模型均在每句回复结尾生硬打断并催促“先睡觉”；
2. **缺乏人类级共情心智**：真人朋友会根据对方话语中的情绪、兴致与字数判断其到底困不困，若对方精神奕奕开新话题则热烈互动接梗，唯有对方表达疲惫时才温柔劝慰；
3. **缺乏消息时间间隔感知（Temporal Blindness）**：模型仅知晓发送当下的绝对时间，完全感知不到两句对话相隔了多久（如：说了晚安 2 分钟后反悔玩手机，与深夜断联 4 小时后秒睡醒来，在模型眼中无差异），导致无法像人类一样推断“是不是聊着聊着秒睡着了”或“是不是刚刚睡醒”。

## Decision
1. **角色提示词与人设心智升级（`角色提示词.txt`）**：
   - 在“真人交流感”下明确加入**生活体温与作息情商规范**，严禁机械催睡与复读闹钟；
   - 确立“话语兴致优先”原则：彩叶聊游戏、动漫、趣事时顺着话题热切畅聊，绝不扫兴打断；仅在彩叶明确流露疲惫、打哈欠、喊累或主动想睡时，才温柔心疼地劝她休息；失眠时温柔陪伴，绝不命令式复读；
   - 刚说晚安又发消息时，展现人类真人的灵动反应（如惊喜、吐槽“抓到一只说晚安后还在玩手机的彩叶！”）；
   - 语料库补充贴合人设的作息关怀台词（如“诶？不是刚说了晚安嘛！怎么一聊到游戏就突然精神了呀www”、“刚才聊着聊着突然没声音了……彩叶，该不会是直接秒睡着了吧？”）；
   - 执行 `npm run sync:prompt` 同步生成 `functions/_generated/role-prompt.ts`。

2. **客户端时间差计算与轻量协议扩展（`lastMessageIntervalMs` 与 `previousTime`）**：
   - 在 `use-chat-controller.ts` 中，利用历史消息中最近两条真实记录的 `createdAt`，在同一客户端本地时钟体系下精确计算回复间隔毫秒数（`lastMessageIntervalMs`）及上一条消息的本地格式化日期时间（`previousTime`）；
   - 在 `StreamChatRequest` 与 `ClientChatRequest` 中增加可选字段 `lastMessageIntervalMs?: number` 与 `previousTime?: string`；
   - `functions/_shared/validation.ts` 对其进行安全类型校验，并在 `allowedTopLevelKeys` 中纳管；
   - 保持每条 `StreamChatMessage` 的核心结构不变，确保对现有测试与上游 LLM 格式的 100% 干净透明。

3. **服务端时态上下文、相对日期语义与时序翻译（`functions/_shared/prompt.ts`）**：
   - 抽象 `formatRelativeDateDescription`，基于 `currentTime` 与 `previousTime` 解析年月日，智能判断相对日期关系（“同一天/今天”、“跨天隔夜/昨晚”、“相隔2天/前天”等）；
   - 抽象 `formatIntervalDescription` 纯函数，支持 `lastMessageIntervalMs` 与历史消息兜底回退：
     - `< 3 分钟`：判定为实时连续热聊；
     - `3 ~ 60 分钟`：格式化为经过具体分钟数；
     - `1 ~ 24 小时`：格式化为经过的小时与分钟，并标注“存在较长回复间隔：彩叶可能中途休息、睡了一觉刚醒、或去忙了其他事情”；
     - `>= 24 小时`：格式化为经过天数；
   - 在 `buildTimeInstruction` 中，将现实绝对时间、上一条对话时间及相对日期关系、回复间隔以及作息关怀原则在中日双语（zh-CN / ja-JP）下自然融入 `<runtime>` 区块，赋能所有上游 Provider（StepFun, OpenAI, Anthropic, Gemini），确保模型清晰区分「今天」与「昨天/昨晚」。

## Alternatives considered
- **在每条 `StreamChatMessage` 上都附带 `createdAt` 时间戳**：
  被否决。上游各大模型厂商（OpenAI, Anthropic, Gemini）官方 API 均无 message 级 `createdAt` 字段，且前端测试中多处对 message 进行严格深比较断言；在顶层显式传递单调精准的 `lastMessageIntervalMs` 与 `previousTime`，既消除了客户端与服务端的时钟漂移，又保持了消息流契约的最小侵入性。
- **纯靠 Prompt 告知当前时间，不提供间隔时间与前序日期**：
  被否决。没有间隔信息和前序日期，大语言模型面对清晨 6 点的消息时，完全无法区分“用户通宵熬到了 6 点”还是“昨晚睡了 8 小时今早 6 点刚醒”；更无法感知“聊着聊着突然消失数小时再出现（秒睡）”的人类日常场景。

## Consequences
- **收益**：
  - 彻底终结了模型像居委会大妈一样每句催睡的扫兴体验，对话情商与人类伴侣感显著跃升；
  - 能够敏锐识别“秒回玩手机”、“隔夜跨天早起”、“睡中秒睡”等真实生活场景，清晰掌握昨天与今天的时间线；
  - 多重向后兼容：当客户端未传递这些字段时自动降级，老版本客户端和测试无缝运行。

## Verification
- `npm run sync:prompt`：成功同步角色提示词
- `npm run typecheck`：三份 tsconfig（app、node、functions）全量通过，0 error
- `npm run lint`：通过，0 error
- `npm run test:unit`：25 测试套件、231 测试用例全部通过
- `npm run test:functions`：22 测试套件、270 测试用例全部通过
