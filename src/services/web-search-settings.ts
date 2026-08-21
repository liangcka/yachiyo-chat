import type { YachiyoDatabase } from "../data/db";

const WEB_SEARCH_ENABLED_KEY = "webSearchEnabled" as const;
const WEB_SEARCH_SHOW_SOURCES_KEY = "webSearchShowSources" as const;
const WEB_SEARCH_SMART_KEY = "webSearchSmart" as const;

export interface WebSearchSettings {
  enabled: boolean;
  showSources: boolean;
  smart: boolean;
}

/** 联网搜索三个开关的缺省值：默认关闭联网、默认显示来源、默认关闭智能搜索 */
export const defaultWebSearchSettings: WebSearchSettings = {
  enabled: false,
  showSources: true,
  smart: false,
};

/**
 * 联网搜索开关的本地读写服务。
 *
 * 设计：
 * - settings 表分别存储 webSearchEnabled / webSearchShowSources / webSearchSmart 三项布尔值。
 * - 缺省 enabled=false、showSources=true、smart=false；存储值非法（非布尔）时回退缺省。
 */
export class WebSearchSettingsService {
  constructor(private readonly db: YachiyoDatabase) {}

  async getWebSearchSettings(): Promise<WebSearchSettings> {
    const [enabledRecord, showSourcesRecord, smartRecord] = await Promise.all([
      this.db.settings.get(WEB_SEARCH_ENABLED_KEY),
      this.db.settings.get(WEB_SEARCH_SHOW_SOURCES_KEY),
      this.db.settings.get(WEB_SEARCH_SMART_KEY),
    ]);
    return {
      enabled:
        enabledRecord?.key === WEB_SEARCH_ENABLED_KEY &&
        typeof enabledRecord.value === "boolean"
          ? enabledRecord.value
          : defaultWebSearchSettings.enabled,
      showSources:
        showSourcesRecord?.key === WEB_SEARCH_SHOW_SOURCES_KEY &&
        typeof showSourcesRecord.value === "boolean"
          ? showSourcesRecord.value
          : defaultWebSearchSettings.showSources,
      smart:
        smartRecord?.key === WEB_SEARCH_SMART_KEY &&
        typeof smartRecord.value === "boolean"
          ? smartRecord.value
          : defaultWebSearchSettings.smart,
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.db.settings.put({ key: WEB_SEARCH_ENABLED_KEY, value: enabled });
  }

  async setShowSources(show: boolean): Promise<void> {
    await this.db.settings.put({ key: WEB_SEARCH_SHOW_SOURCES_KEY, value: show });
  }

  async setSmart(smart: boolean): Promise<void> {
    await this.db.settings.put({ key: WEB_SEARCH_SMART_KEY, value: smart });
  }

  async clear(): Promise<void> {
    await this.db.settings.bulkDelete([
      WEB_SEARCH_ENABLED_KEY,
      WEB_SEARCH_SHOW_SOURCES_KEY,
      WEB_SEARCH_SMART_KEY,
    ]);
  }
}
