import humanizerContent from "./humanizer/SKILL.md?raw";
import deepReasoningContent from "./deep-reasoning/SKILL.md?raw";
import emotionalInsightContent from "./emotional-insight/SKILL.md?raw";
import factGroundingContent from "./fact-grounding/SKILL.md?raw";
import knowledgeStructuringContent from "./knowledge-structuring/SKILL.md?raw";

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** SKILL.md 原文，启用后作为技能指令注入对话 */
  readonly content: string;
}

export const SKILLS: readonly SkillDefinition[] = [
  {
    id: "deep-reasoning",
    name: "深度思维",
    description: "多步拆解与逻辑推理，输出深层见解",
    content: deepReasoningContent,
  },
  {
    id: "emotional-insight",
    name: "情感洞察",
    description: "敏锐捕捉情绪与潜台词，提供高情商温暖共鸣",
    content: emotionalInsightContent,
  },
  {
    id: "fact-grounding",
    name: "精准事实",
    description: "严谨事实核对与抗幻觉，时序逻辑自洽",
    content: factGroundingContent,
  },
  {
    id: "knowledge-structuring",
    name: "知识条理",
    description: "结构化梳理复杂概念，清晰层次分明",
    content: knowledgeStructuringContent,
  },
  {
    id: "humanizer",
    name: "Humanizer",
    description: "去除文本中的 AI 味，让输出更像真人写作",
    content: humanizerContent,
  },
];

