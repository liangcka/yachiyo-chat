import { BingWebSearchProvider } from "./bing";
import { BochaWebSearchProvider } from "./bocha";
import { BraveWebSearchProvider } from "./brave";
import { DeepSeekWebSearchProvider } from "./deepseek";
import { DuckDuckGoWebSearchProvider } from "./duckduckgo";
import { ExaWebSearchProvider } from "./exa";
import { GoogleWebSearchProvider } from "./google";
import { JinaWebSearchProvider } from "./jina";
import { PerplexityWebSearchProvider } from "./perplexity";
import { SearXNGWebSearchProvider } from "./searxng";
import { TavilyWebSearchProvider } from "./tavily";
import type { WebSearchProvider } from "./types";

/**
 * 默认搜索引擎提供商标准执行链列表
 */
export const defaultProviderList: readonly WebSearchProvider[] = [
  new DeepSeekWebSearchProvider(),
  new ExaWebSearchProvider(),
  new TavilyWebSearchProvider(),
  new PerplexityWebSearchProvider(),
  new BraveWebSearchProvider(),
  new BochaWebSearchProvider(),
  new SearXNGWebSearchProvider(),
  new GoogleWebSearchProvider(),
  new JinaWebSearchProvider(),
  new BingWebSearchProvider(),
];

export const allKnownProviderList: readonly WebSearchProvider[] = [
  ...defaultProviderList,
  new DuckDuckGoWebSearchProvider(),
];

/**
 * 搜索引擎 Provider 注册与管理中心：
 * 负责维护所有已注册的 Provider、按环境变量智能解析执行优先级链。
 */
export class WebSearchProviderRegistry {
  private readonly providers = new Map<string, WebSearchProvider>();

  constructor(initialProviders: readonly WebSearchProvider[] = allKnownProviderList) {
    for (const provider of initialProviders) {
      this.register(provider);
    }
  }

  /** 注册新的 Provider */
  register(provider: WebSearchProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  /** 获取指定 ID 的 Provider */
  get(id: string): WebSearchProvider | undefined {
    return this.providers.get(id.toLowerCase());
  }

  /** 获取所有已知 Provider 列表 */
  getAll(): WebSearchProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 根据当前环境（如 DSH_WEB_SEARCH_PROVIDER 优先配置）解析可用的 Provider 级联队列
   */
  resolveProviders(env?: Record<string, unknown>): WebSearchProvider[] {
    const preferredId =
      typeof env?.DSH_WEB_SEARCH_PROVIDER === "string"
        ? env.DSH_WEB_SEARCH_PROVIDER.toLowerCase().trim()
        : undefined;

    const all = this.getAll();
    if (!preferredId) {
      return all;
    }

    const preferred = all.filter((p) => p.id.toLowerCase() === preferredId);
    const rest = all.filter((p) => p.id.toLowerCase() !== preferredId);
    return [...preferred, ...rest];
  }
}

/** 全局单例注册表 */
export const globalProviderRegistry = new WebSearchProviderRegistry();
