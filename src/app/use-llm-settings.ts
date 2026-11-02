import { useCallback, useMemo, useState } from "react";
import type { ActiveLlmConfig, LlmProviderEntry, ProviderId } from "../domain/llm";
import type { LlmSettingsService } from "../services/llm-settings";

export interface LlmSettingsState {
  entries: readonly LlmProviderEntry[];
  activeProvider?: ProviderId;
  /** 当前激活厂商的完整配置；未激活或缺少条目时为 undefined（走服务端默认模型）。 */
  activeConfig?: ActiveLlmConfig;
  /** 从存储读取并应用；失败时抛出，由调用方决定提示方式。 */
  load(): Promise<void>;
  /** 读取失败时以通用错误提示用户。 */
  refresh(): Promise<void>;
  save(provider: ProviderId, apiKey: string, model: string): Promise<void>;
  clear(provider: ProviderId): Promise<void>;
  activate(provider: ProviderId): Promise<void>;
  /** 清空全部厂商配置（清除本地数据时调用）。 */
  reset(): Promise<void>;
}

export function useLlmSettings(
  service: LlmSettingsService,
  onRefreshFailed: () => void,
): LlmSettingsState {
  const [entries, setEntries] = useState<readonly LlmProviderEntry[]>([]);
  const [activeProvider, setActiveProvider] = useState<ProviderId>();

  const activeConfig = useMemo<ActiveLlmConfig | undefined>(() => {
    if (activeProvider === undefined) return undefined;
    const entry = entries.find((item) => item.provider === activeProvider);
    return entry === undefined
      ? undefined
      : { provider: entry.provider, apiKey: entry.apiKey, model: entry.model };
  }, [activeProvider, entries]);

  const load = useCallback(async () => {
    const [records, active] = await Promise.all([service.list(), service.getActiveProvider()]);
    setEntries(records.map(({ provider, apiKey, model }) => ({ provider, apiKey, model })));
    setActiveProvider(active);
  }, [service]);

  const refresh = useCallback(async () => {
    try {
      await load();
    } catch {
      onRefreshFailed();
    }
  }, [load, onRefreshFailed]);

  const save = useCallback(async (provider: ProviderId, apiKey: string, model: string) => {
    await service.saveProvider(provider, apiKey, model);
    await refresh();
  }, [refresh, service]);

  const clear = useCallback(async (provider: ProviderId) => {
    await service.clear(provider);
    await refresh();
  }, [refresh, service]);

  const activate = useCallback(async (provider: ProviderId) => {
    await service.setActiveProvider(provider);
    setActiveProvider(provider);
  }, [service]);

  const reset = useCallback(async () => {
    await service.clearAll();
    setEntries([]);
    setActiveProvider(undefined);
  }, [service]);

  return { entries, activeProvider, activeConfig, load, refresh, save, clear, activate, reset };
}
