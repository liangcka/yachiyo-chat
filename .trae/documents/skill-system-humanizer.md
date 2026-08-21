# 计划：侧边栏技能系统 + humanizer 初始技能

## 一、总结

在 Yachiyo Chat 侧边栏（MenuDrawer）新增「技能」入口，建立可扩展的技能系统：技能以 `SKILL.md` 静态文件形式内置（Vite `?raw` 导入），在技能面板中可查看内容并启用；启用后技能内容以「技能指令」消息对（user + assistant）注入 LLM 请求（复用现有摘要注入模式，纯前端实现，不改后端）。首个预置技能为 **humanizer**（去除文本 AI 味，让输出更像真人写作）。

## 二、现状分析（基于代码探索）

- **技术栈**：React 18 + TypeScript + Vite（PWA），Cloudflare Pages Functions 后端（`functions/api/chat.ts`）。
- **侧边栏**：[MenuDrawer.tsx](file:///d:/程序/web/Yachiyo%20chat/src/components/MenuDrawer.tsx) 的 `nav.drawer__actions`（L101-136）是菜单项容器，每项为「图标 + 文案」按钮，通过回调 props 接入 App.tsx。
- **面板模式**：HistoryPanel / LlmSettingsPanel 均采用 `overlay + panel + useClosing(open, 300)` 骨架，头部含标题与关闭按钮，聚焦管理齐全。
- **消息注入点**：[use-chat-controller.ts](file:///d:/程序/web/Yachiyo%20chat/src/app/use-chat-controller.ts) 的 `makeRequestMessages`（L274-331）已实现「摘要注入」模式——`【前情提要】` user 消息 + assistant 确认消息拼在历史前，并从 `maximumRequestMessages`(20) 中预留槽位。技能注入完全复用此模式。
- **system prompt 归属**：`StreamChatMessage.role` 仅有 `user | assistant`，system prompt 由后端注入；因此技能指令采用前端 user/assistant 消息对方案（与摘要一致），无需改后端。
- **持久化惯例**：设置存 Dexie `settings` store（key-value，[db.ts](file:///d:/程序/web/Yachiyo%20chat/src/data/db.ts) `AppSetting` union 类型），service 层封装（参考 `LlmSettingsService`）。`settings` store schema 不变，扩展 `AppSetting` union 即可，**无需 db 版本升级**。
- **文案**：全部 UI 文案走 [messages.ts](file:///d:/程序/web/Yachiyo%20chat/src/i18n/messages.ts) 的 `UiCopy` 接口（zh-CN + ja-JP 双语同步）。
- **样式**：单文件 [chat.css](file:///d:/程序/web/Yachiyo%20chat/src/styles/chat.css)，BEM 命名（`.history-panel__empty` 等）。
- `src/vite-env.d.ts` 已存在，`*.md?raw` 导入有类型支持。

## 三、变更清单

### 新建文件

#### 1. `src/skills/humanizer/SKILL.md` — humanizer 技能定义

内容按用户规格撰写（中文），包含五部分：

1. **技能定位**：说明本技能用于改写文本，去除 AI 味，让文字像真人写的；适用于任何文风改写请求。
2. **四层自检体系**：
   - **L1 硬性规则（零容忍）**：禁用词（「不是…而是…」「值得注意的是」「综上所述」）、套路句式（「首先/其次/最后」）、违规标点（破折号滥用）——扫描到立即替换。
   - **L2 风格一致性**：开头要具体（拒绝空泛铺垫）、长短句交错、口语化表达。
   - **L3 内容质量**：观点必须有细节支撑、比喻必须符合逻辑、删除空洞大词（赋能/闭环/抓手/底层逻辑）。
   - **L4 活人感终审**：通读全文，判断「像不像真人写的」，不像就继续改，直到通过。
3. **处理流程**：第一步扫描诊断 AI 味程度（轻度/中度/重度）→ 第二步三步改写（去泛化 → 去书面化 → 回自然感）→ 第三步输出修改统计（替换词数量、句式调整数、诊断等级）。
4. **禁用词表**（替换参考）：堆叠副词（猛地/狠狠/仿佛/瞬间/稳稳）、套路短语（稳稳地接住你/先说答案/掰开了揉碎了）、互联网黑话（底层逻辑/赋能/闭环/抓手）等，每个附替换建议。
5. **输出要求**：改写后文本 + 修改统计摘要。

#### 2. `src/skills/index.ts` — 技能注册表

```ts
import humanizerContent from "./humanizer/SKILL.md?raw";

export interface SkillDefinition {
  readonly id: string;          // "humanizer"
  readonly name: string;        // 展示名 "Humanizer"
  readonly description: string; // 一句话描述（技能定位摘要）
  readonly content: string;     // SKILL.md 原文
}

export const SKILLS: readonly SkillDefinition[] = [
  { id: "humanizer", name: "Humanizer", description: "去除文本中的 AI 味，让输出更像真人写作", content: humanizerContent },
];
```

后续新增技能 = 新建 `src/skills/<id>/SKILL.md` + 在此数组登记一项。

#### 3. `src/services/skill-settings.ts` — 技能启用状态持久化

参考 `LlmSettingsService` 模式，基于 `db.settings` 存取：

```ts
export class SkillSettingsService {
  constructor(private readonly db: YachiyoDatabase) {}
  async getActiveSkillIds(): Promise<string[]>;   // 读 { key: "activeSkills" } ，默认 []
  async setActiveSkillIds(ids: string[]): Promise<void>;  // 过滤掉未注册 id 后写入
}
```

#### 4. `src/components/SkillsPanel.tsx` — 技能面板

复用 HistoryPanel 面板骨架（`overlay overlay--skills` + `skills-panel` + `useClosing` + 聚焦关闭按钮 + Escape 关闭）：

- **列表**：每个技能一行——名称、描述、启用/停用开关按钮（`aria-pressed`，参考 MenuDrawer 语言切换写法）。
- **内容查看**：点击技能行展开/收起 `SKILL.md` 原文（`<details>` 或受控展开，`pre-wrap` 展示，便于「读取 SKILL.md 确认技能已生效」）。
- Props：`copy`、`skills`（SKILLS）、`activeIds`、`open`、`onClose`、`onToggle(id, next: boolean)`。

### 修改文件

#### 5. `src/data/db.ts` — AppSetting 扩展

```ts
export type AppSetting =
  | { key: "locale"; value: Locale }
  | { key: "activeProvider"; value: ProviderId }
  | { key: "activeSkills"; value: string[] };   // 新增
```

settings store schema 不变，无需 `version(3)`。

#### 6. `src/i18n/messages.ts` — 新增文案（zh-CN / ja-JP 同步）

`UiCopy` 新增只读字段：

| 字段 | zh-CN | ja-JP |
|---|---|---|
| `skillsEntry` | 技能 | スキル |
| `skillsTitle` | 技能 | スキル |
| `skillsDescription` | 供对话调用的文本处理技能 | 会話で使用するテキスト処理スキル |
| `skillEnable` | 启用 | 有効にする |
| `skillDisable` | 停用 | 無効にする |
| `skillToggleLabel` | 切换技能启用状态 | スキルの有効/無効を切り替える |
| `skillViewContent` | 查看技能说明 | スキルの説明を見る |
| `skillHideContent` | 收起技能说明 | スキルの説明を閉じる |

#### 7. `src/components/MenuDrawer.tsx` — 侧边栏新增入口

- Props 增加 `onSkills: () => void`。
- `drawer__actions` nav 中（LLM 设置按钮之后）新增按钮：`<Sparkles aria-hidden size={21} />` + `copy.skillsEntry`，点击 `onClose(); onSkills();`（与 LLM 设置按钮行为一致）。

#### 8. `src/App.tsx` — 接线

- 新增 state：`skillsOpen`、`activeSkillIds: string[]`。
- 生产服务注入 `skillSettings: new SkillSettingsService(productionDatabase)`（AppServices 可选字段，与 llmSettings 同模式）。
- 认证成功后（现有 LLM 设置读取处）顺带 `setActiveSkillIds(await skillSettings.getActiveSkillIds())`。
- `handleSkillToggle(id, next)`：更新 state + `void skillSettings.setActiveSkillIds(...)`。
- 计算 `activeSkills = SKILLS.filter(s => activeSkillIds.includes(s.id))`，传入 `useChatController({ ..., activeSkills })`。
- 渲染 `<SkillsPanel ...>`（与 HistoryPanel 并列）。
- MenuDrawer 传入 `onSkills={() => { setMenuOpen(false); setSkillsOpen(true); }}`。

#### 9. `src/app/use-chat-controller.ts` — 技能指令注入

- `ChatControllerOptions` 新增 `activeSkills?: readonly SkillDefinition[]`；内部以 `activeSkillsRef` 保存（与 `activeLlmConfig` 同模式）。
- `makeRequestMessages` 中，在摘要注入逻辑旁新增（技能指令置于消息数组**最前**，优先级最高）：

```ts
const skills = activeSkillsRef.current ?? [];
// 有技能时：
const skillUserText = `【技能指令 / Skill Instructions】\n以下技能已激活，回复时必须严格遵守：\n\n${skills.map(s => s.content).join("\n\n---\n\n")}`;
const skillAssistantText = locale === "ja-JP" ? "（技能指示を確認しました。厳守して実行します）" : "（已收到技能指令，将严格遵守执行）";
```

- 槽位预算：`maxHistoryMessages = 20 - (hasSummary ? 2 : 0) - skills.length * 2`。
- 字符预算：`reserveCharacters` 加上技能指令消息对字符数（与 summaryChars 同处理）。
- 返回结构：`[...skillPair?, ...summaryPair?, ...chatMessages]`。

#### 10. `src/styles/chat.css` — 面板样式

新增 BEM 样式块（复用 `.history-panel` 的布局基调）：

- `.skills-panel`：面板容器（与 `.history-panel` 同级的抽屉样式）。
- `.skills-panel > header`：标题 + 关闭按钮（复用现有 drawer__header 样式模式）。
- `.skills-panel__item`：技能行（名称 + 描述 + 开关）。
- `.skills-panel__toggle`：启用开关按钮，`aria-pressed="true"` 高亮态（参考语言切换按钮样式）。
- `.skills-panel__content`：SKILL.md 原文展示区（`white-space: pre-wrap`、限高滚动、等宽或正文字体）。

## 四、假设与决策

1. **技能可多选启用**（每个技能独立开关，无互斥）；注入顺序按 `SKILLS` 注册顺序。当前仅 1 个技能，多选设计为后续扩展留余地且实现最简。
2. **不改后端**：技能指令走前端 user/assistant 消息对（与摘要注入同模式），保持 `/api/chat` 契约不变。
3. **技能内容为只读内置**：UI 仅展示与开关，不提供编辑（用户已确认静态文件方案）。
4. **启用状态持久化在 settings store**（`activeSkills`），清空数据（`handleClearData`）时技能状态一并清除——遵循现有 `clearAll` 行为（settings 表被 clearAll 清空后 activeSkillIds state 同步置空，需在 `handleClearData` 中补 `setActiveSkillIds([])`）。
5. humanizer SKILL.md 用中文撰写（技能面向中文去 AI 味场景，禁用词表均为中文词条）。

## 五、验证步骤

1. **类型与规范**：`npx tsc --noEmit`（或项目等效 typecheck）与 `npm run lint` 通过。
2. **单元测试**：`npm run test` 全绿；如存在 use-chat-controller 相关测试，补充断言——启用技能时请求消息以技能指令消息对开头、槽位预算正确扣减。
3. **读取 SKILL.md 确认生效**：用 Read 工具读取 `src/skills/humanizer/SKILL.md` 确认内容完整（技能定位、四层自检、处理流程、禁用词表俱全）。
4. **浏览器冒烟测试**（dev server + 浏览器工具）：
   - 打开菜单抽屉 → 出现「技能」入口；
   - 打开技能面板 → Humanizer 技能可见，展开能读到 SKILL.md 原文；
   - 点击「启用」→ 刷新页面状态保持（IndexedDB 持久化）；
   - 发送一条测试消息，通过浏览器网络面板确认 `/api/chat` 请求体首条消息为技能指令。
5. **构建**：`npm run build` 成功。
6. **清理**：任务中产生的临时测试文件在结束前删除；最后给用户一句 humanizer 使用说明。
