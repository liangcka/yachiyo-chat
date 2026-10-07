# Agent Note: 助手贴图消息（[sticker:id] 文本标记协议）

Status: implemented

## Problem

角色「月见八千代」的情绪表达仅依赖括号动作描写与纯文本，缺少即时通讯中直观的视觉化情绪通道。需求是让模型自主判断是否发送角色贴图、并选择契合当前对话情绪的一张，同时不破坏既有的流式传输、多气泡拆分与历史持久化链路。

## Decision

采用文本标记协议：模型以 `[sticker:id]` 作为一条独立消息的全部内容发送贴图（独占一行，与其余消息之间沿用换行或 `---` 分隔）。

- **目录单一事实源**：根目录 `sticker-catalog.json`（id / file / alt / scenes）为唯一权威；`scripts/sync-sticker-catalog.mjs` 校验 id 与文件名格式后生成 `src/features/sticker/catalog.gen.ts` 与 `functions/_generated/sticker-catalog.ts` 两份类型化模块，挂载于 prebuild / pretypecheck / pretest:functions，机制与 `sync:prompt` 同构。
- **服务端契约**：`functions/_shared/prompt.ts` 在 `<runtime>` 段注入中日双语贴图指令与目录行（id 与适用场景一一对应），约束发送时机（情绪鲜明且场景契合、一次回复至多一张、平稳或低落语境不发）与 id 白名单。
- **前端渲染**：`src/features/sticker/parse.ts` 的 `splitStickerPieces` 将气泡文本展开为文本/贴图渲染片段——已知标记渲染为 `img.message-bubble__sticker`，目录外标记从文本中剔除；`stripPartialStickerToken` 在流式期间隐藏尾部未闭合标记，隐藏后无剩余内容时回退为 typing 气泡。`MessageBubble` 在拆分器气泡之后做该展开，来源列表与截断提示依附最后一个文本气泡。
- **资产与持久化**：贴图存放 `public/stickers/`，随 Vite 构建与 Capacitor `webDir: dist` 进入 PWA 与 APK；消息存储保留含标记的原文，历史回放由展示层重新解析渲染，Dexie schema 无需升级。

## Alternatives considered

- **扩展 SSE 事件与消息字段**（新增 `sticker` 事件类型 + `ChatMessage.stickerId`）：需同时改动流协议、reducer、持久化与历史兼容，而文本标记可天然复用 delta 流、多气泡拆分与既有存储，收益不抵复杂度。
- **仿照 `imageId` 的附件模型**：贴图是固定目录资产而非用户上传二进制，模型无法直接产出附件字段，且每张贴图需独立存储记录，违背目录化设计。
- **目录写入 `角色提示词.txt`**：目录与前端资产强绑定，放入角色提示词会丧失单一事实源与 sync 校验，且人设正文与运行时资产清单职责混淆。

## Consequences

- 模型可能输出目录外 id 或行内标记：展示层已做剔除与展开降级，并有测试覆盖；原始标记不会泄漏到界面。
- 贴图标记计入服务端输出字符上限（约 15 字符/张），相对 200 字符上限可忽略。
- `public/stickers/` 包含 14 张角色贴图（含 8 张 GIF 动图与静态 WebP/PNG/JPEG，共约 11MB），计入 PWA 与 APK 体积；按文件魔数严格对齐真实扩展名（`.gif` / `.webp` / `.png` / `.jpg`），杜绝 GDI+ 图像截断为单帧的问题，完整保留原始多帧动画与透明通道。
- 增删贴图仅需修改 `sticker-catalog.json` 与 `public/stickers/` 资产并运行 `npm run sync:stickers`，前后端目录自动保持一致。

## Verification

- `npm run typecheck`（三份 tsconfig）通过。
- `npm run lint` 通过。
- `npm run test:unit`：267 项通过，含 `src/features/sticker/parse.test.ts` 与 `src/components/MessageBubble.test.tsx` 的贴图解析、渲染、流式残尾与未知 id 降级用例。
- `npm run test:functions`：287 项通过，含 `functions-tests/_shared/prompt.test.ts` 的贴图指令与目录注入用例。
