import humanizerContent from "./humanizer/SKILL.md?raw";

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** SKILL.md 原文，启用后作为技能指令注入对话 */
  readonly content: string;
}

export const SKILLS: readonly SkillDefinition[] = [
  {
    id: "humanizer",
    name: "Humanizer",
    description: "去除文本中的 AI 味，让输出更像真人写作",
    content: humanizerContent,
  },
];
