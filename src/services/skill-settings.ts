import type { YachiyoDatabase } from "../data/db";
import { SKILLS } from "../skills";

const ACTIVE_SKILLS_KEY = "activeSkills" as const;

/**
 * 技能启用状态的本地读写服务。
 *
 * 设计：
 * - settings 表的 activeSkills 项存储已启用技能的 id 列表。
 * - 读写时均按当前注册表（SKILLS）过滤，未注册的 id 自动剔除。
 */
export class SkillSettingsService {
  constructor(private readonly db: YachiyoDatabase) {}

  async getActiveSkillIds(): Promise<string[]> {
    const record = await this.db.settings.get(ACTIVE_SKILLS_KEY);
    if (record?.key !== ACTIVE_SKILLS_KEY) return [];
    const value = record.value;
    if (!Array.isArray(value)) return [];
    const registered = new Set(SKILLS.map((skill) => skill.id));
    return value.filter((id): id is string => typeof id === "string" && registered.has(id));
  }

  async setActiveSkillIds(ids: readonly string[]): Promise<void> {
    const registered = new Set(SKILLS.map((skill) => skill.id));
    const unique = [...new Set(ids.filter((id) => registered.has(id)))];
    await this.db.settings.put({ key: ACTIVE_SKILLS_KEY, value: unique });
  }

  async clear(): Promise<void> {
    await this.db.settings.delete(ACTIVE_SKILLS_KEY);
  }
}
