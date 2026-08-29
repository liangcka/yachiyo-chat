import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface DeepSeekStructuredResult {
  title?: string;
  url?: string;
  snippet?: string;
  publishedAt?: string;
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * 对齐 DeepSeek Harness (DSH) packages/web/web-search-deepseek
 * 基于 DeepSeek API 的官方网页检索与结构化证据提取规范。
 */
export class DeepSeekWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "deepseek";
  readonly name = "DeepSeek Web Search";

  available(env?: Record<string, unknown>): boolean {
    return typeof env?.DEEPSEEK_API_KEY === "string" && env.DEEPSEEK_API_KEY.length > 0;
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const apiKey = request.apiKey || (env?.DEEPSEEK_API_KEY as string | undefined);
    if (!apiKey) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }

    const baseURL =
      (env?.DEEPSEEK_BASE_URL as string | undefined) || "https://api.deepseek.com";
    const model =
      (env?.DEEPSEEK_SEARCH_MODEL as string | undefined) || "deepseek-v4-flash";
    const maxResults = request.maxResults ?? 5;

    const endpoint = baseURL.endsWith("/")
      ? `${baseURL}chat/completions`
      : `${baseURL}/chat/completions`;

    const systemPrompt = [
      "You are the DeepSeek Web Search engine for DeepSeek Harness (DSH).",
      `Given the user search query, retrieve the top ${maxResults} relevant, authoritative web search results.`,
      "Output ONLY a valid JSON array matching this exact schema, without markdown code fences or conversational text:",
      '[{"title":"string","url":"https://...","snippet":"string","publishedAt":"YYYY-MM-DD"}]',
    ].join(" ");

    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: queryStr },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
          }),
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as DeepSeekChatResponse;
      const content = data.choices?.[0]?.message?.content?.trim() || "[]";

      // 提取 JSON 数组或包含 results 键的对象
      let parsedItems: DeepSeekStructuredResult[] = [];
      try {
        const parsed = JSON.parse(content) as unknown;
        if (Array.isArray(parsed)) {
          parsedItems = parsed as DeepSeekStructuredResult[];
        } else if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { results?: unknown[] }).results)
        ) {
          parsedItems = (parsed as { results: DeepSeekStructuredResult[] }).results;
        }
      } catch {
        // 若直接解析失败，尝试正则截取 JSON 数组
        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            parsedItems = JSON.parse(match[0]) as DeepSeekStructuredResult[];
          } catch {
            return [];
          }
        }
      }

      const rawResults = parsedItems.map((item) =>
        this.formatResultItem({
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          publishedAt: item.publishedAt,
        }),
      );

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
