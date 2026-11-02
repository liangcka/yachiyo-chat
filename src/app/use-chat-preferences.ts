import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillSettingsService } from "../services/skill-settings";
import {
  defaultWebSearchSettings,
  type WebSearchSettings,
  type WebSearchSettingsService,
} from "../services/web-search-settings";
import { SKILLS, type SkillDefinition } from "../skills";
import type { AppRepository } from "./app-services";

export interface ChatPreferences {
  activeSkillIds: readonly string[];
  activeSkills: readonly SkillDefinition[];
  toggleSkill(id: string, next: boolean): Promise<void>;
  webSearch: WebSearchSettings;
  changeWebSearch(partial: Partial<WebSearchSettings>): void;
  multiBubble: boolean;
  changeMultiBubble(enabled: boolean): Promise<void>;
  /** 读取依赖登录态的技能与联网搜索设置；读取失败回退缺省值，不抛出。 */
  load(): Promise<void>;
  /** 恢复全部偏好为缺省值并清除存储（清除本地数据时调用）。 */
  reset(): Promise<void>;
}

export interface ChatPreferencesOptions {
  repository: Pick<AppRepository, "getMultiBubble" | "setMultiBubble">;
  skillService: SkillSettingsService;
  webSearchService: WebSearchSettingsService;
}

/**
 * 聊天偏好（技能、联网搜索、分条消息）的内存态与持久化。
 * 内存态先行更新保证界面即时响应，写入失败静默忽略，下次读取以存储为准。
 */
export function useChatPreferences({
  repository,
  skillService,
  webSearchService,
}: ChatPreferencesOptions): ChatPreferences {
  const [activeSkillIds, setActiveSkillIds] = useState<readonly string[]>([]);
  const [webSearch, setWebSearch] = useState<WebSearchSettings>(defaultWebSearchSettings);
  const [multiBubble, setMultiBubble] = useState(true);
  // 切换类操作基于最新已提交值计算，避免在 setState 更新函数里执行存储副作用
  const skillIdsRef = useRef<readonly string[]>([]);
  const webSearchRef = useRef<WebSearchSettings>(defaultWebSearchSettings);

  const applySkillIds = useCallback((ids: readonly string[]) => {
    skillIdsRef.current = ids;
    setActiveSkillIds(ids);
  }, []);

  const applyWebSearch = useCallback((settings: WebSearchSettings) => {
    webSearchRef.current = settings;
    setWebSearch(settings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void repository.getMultiBubble?.()
      .then((saved) => {
        if (typeof saved === "boolean" && !cancelled) setMultiBubble(saved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const activeSkills = useMemo(
    () => SKILLS.filter((skill) => activeSkillIds.includes(skill.id)),
    [activeSkillIds],
  );

  const toggleSkill = useCallback(async (id: string, next: boolean) => {
    const current = skillIdsRef.current;
    const updated = next ? [...new Set([...current, id])] : current.filter((skillId) => skillId !== id);
    applySkillIds(updated);
    await skillService.setActiveSkillIds(updated).catch(() => undefined);
  }, [applySkillIds, skillService]);

  const changeWebSearch = useCallback((partial: Partial<WebSearchSettings>) => {
    const next = { ...webSearchRef.current, ...partial };
    applyWebSearch(next);
    void webSearchService.set(next).catch(() => undefined);
  }, [applyWebSearch, webSearchService]);

  const changeMultiBubble = useCallback(async (enabled: boolean) => {
    setMultiBubble(enabled);
    await repository.setMultiBubble?.(enabled).catch(() => undefined);
  }, [repository]);

  const load = useCallback(async () => {
    const [skillIds, webSearchSettings] = await Promise.all([
      skillService.getActiveSkillIds().catch(() => []),
      webSearchService.getWebSearchSettings().catch(() => defaultWebSearchSettings),
    ]);
    applySkillIds(skillIds);
    applyWebSearch(webSearchSettings);
  }, [applySkillIds, applyWebSearch, skillService, webSearchService]);

  const reset = useCallback(async () => {
    applySkillIds([]);
    await skillService.clear();
    applyWebSearch(defaultWebSearchSettings);
    await webSearchService.clear().catch(() => undefined);
    setMultiBubble(true);
    await repository.setMultiBubble?.(true).catch(() => undefined);
  }, [applySkillIds, applyWebSearch, repository, skillService, webSearchService]);

  return {
    activeSkillIds,
    activeSkills,
    toggleSkill,
    webSearch,
    changeWebSearch,
    multiBubble,
    changeMultiBubble,
    load,
    reset,
  };
}
