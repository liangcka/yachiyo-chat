import type { ChatLocale } from "../../validation";
import type { WebSearchResult } from "../types";

export interface WebSearchRequest {
  readonly query: string | readonly string[];
  readonly locale?: ChatLocale;
  readonly maxResults?: number;
  readonly smart?: boolean;
  readonly apiKey?: string;
}

/**
 * 搜索引擎提供商元数据与能力描述
 */
export interface ProviderMetadata {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly requiresApiKey?: boolean;
  readonly envKey?: string;
}

/**
 * 对齐 DeepSeek Harness (DSH) packages/web/web/src/types.ts 中的 WebSearchProvider 规范。
 */
export interface WebSearchProvider {
  readonly id: string;
  readonly name: string;
  /** 本地快速可用性检测（无网络消耗） */
  available(env?: Record<string, unknown>): boolean;
  /** 执行搜索并返回结构化结果列表 */
  search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]>;
}
