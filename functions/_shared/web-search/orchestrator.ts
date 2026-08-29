import type { ChatLocale } from "../validation";
import { dedupeByDomain, maximumSmartResults, maximumStandardResults } from "./merge";
import { DEFAULT_SEARCH_TIMEOUT_MS } from "./providers/base";
import {
  globalProviderRegistry,
  WebSearchProviderRegistry,
} from "./providers/registry";
import type { WebSearchProvider, WebSearchRequest } from "./providers/types";
import type { WebSearchResult } from "./types";

export interface SearchOrchestratorOptions {
  registry?: WebSearchProviderRegistry;
}

export interface SearchOptions {
  query: string | readonly string[];
  locale?: ChatLocale;
  signal?: AbortSignal;
  smart?: boolean;
  env?: Record<string, unknown>;
}

const BATCH_SIZE = 2;

async function runBatch(
  batch: readonly WebSearchProvider[],
  request: WebSearchRequest,
  parentSignal: AbortSignal | undefined,
  env: Record<string, unknown> | undefined,
  timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS,
): Promise<WebSearchResult[] | null> {
  if (batch.length === 0 || parentSignal?.aborted) {
    return null;
  }

  const controllers = batch.map(() => new AbortController());
  const timers: ReturnType<typeof setTimeout>[] = [];

  const handleParentAbort = () => {
    for (const c of controllers) {
      c.abort();
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      handleParentAbort();
    } else {
      parentSignal.addEventListener("abort", handleParentAbort, { once: true });
    }
  }

  const cleanup = () => {
    for (const t of timers) {
      clearTimeout(t);
    }
    if (parentSignal) {
      parentSignal.removeEventListener("abort", handleParentAbort);
    }
  };

  try {
    const tasks = batch.map((provider, index) => {
      const controller = controllers[index]!;
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      timers.push(timer);

      return provider
        .search(request, controller.signal, env)
        .then((results) => {
          if (results && results.length > 0) {
            return { index, results };
          }
          return null;
        })
        .catch(() => null);
    });

    return await new Promise<WebSearchResult[] | null>((resolve) => {
      let pendingCount = tasks.length;
      let settled = false;

      for (const task of tasks) {
        void task.then((res) => {
          if (settled) return;
          if (res !== null) {
            settled = true;
            // 中止同批内其他未完成的 provider 请求
            for (let i = 0; i < controllers.length; i++) {
              if (i !== res.index) {
                controllers[i]?.abort();
              }
            }
            resolve(res.results);
            return;
          }
          pendingCount--;
          if (pendingCount === 0 && !settled) {
            settled = true;
            resolve(null);
          }
        });
      }
    });
  } finally {
    cleanup();
  }
}

/**
 * 统一网络搜索编排调度引擎 (SearchOrchestrator)：
 * 1. 结合环境配置 (DSH_WEB_SEARCH_PROVIDER 等) 与可用性决议候选 Provider 执行链；
 * 2. 批内（批次大小 2）并行发起竞速搜索，取首个非空成功结果并联动中断同批其余请求；
 * 3. 单 provider 施加 8 秒超时保护，整批失败/空结果时向后降级尝试下一批；
 * 4. 结果统一经过可注册域名频次去重 (dedupeByDomain) 约束，确保信息多样性。
 */
export class SearchOrchestrator {
  private readonly registry: WebSearchProviderRegistry;

  constructor(options?: SearchOrchestratorOptions) {
    this.registry = options?.registry ?? globalProviderRegistry;
  }

  async search(options: SearchOptions): Promise<WebSearchResult[]> {
    const { query, locale = "zh-CN", signal, smart = false, env } = options;

    if (signal?.aborted) {
      return [];
    }

    const rawQueries = typeof query === "string" ? [query] : query;
    const queries = [...new Set(rawQueries.map((q) => q.trim()).filter((q) => q.length > 0))];
    if (queries.length === 0) {
      return [];
    }

    const maxResults = smart ? maximumSmartResults : maximumStandardResults;
    const request: WebSearchRequest = {
      query: queries.length === 1 && queries[0] !== undefined ? queries[0] : queries,
      locale,
      smart,
      maxResults,
    };

    const providers = this.registry.resolveProviders(env);
    const availableProviders = providers.filter((provider) =>
      this.isProviderAvailable(provider, env),
    );

    for (let i = 0; i < availableProviders.length; i += BATCH_SIZE) {
      if (signal?.aborted) {
        return [];
      }

      const batch = availableProviders.slice(i, i + BATCH_SIZE);
      const results = await runBatch(batch, request, signal, env);
      if (results && results.length > 0) {
        return dedupeByDomain(results).slice(0, maxResults);
      }
    }

    return [];
  }

  private isProviderAvailable(
    provider: WebSearchProvider,
    env?: Record<string, unknown>,
  ): boolean {
    try {
      return provider.available(env);
    } catch {
      return false;
    }
  }
}

export const defaultSearchOrchestrator = new SearchOrchestrator();

/**
 * 统一网络搜索入口函数（对象参数签名）：
 */
export async function searchWeb(options: SearchOptions): Promise<WebSearchResult[]> {
  return defaultSearchOrchestrator.search(options);
}
