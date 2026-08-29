import { fetchWithTimeout } from "../http";
import type { WebSearchResult } from "../types";
import { BaseWebSearchProvider, DEFAULT_SEARCH_TIMEOUT_MS } from "./base";
import type { WebSearchRequest } from "./types";

interface GoogleSearchItem {
  title?: string;
  link?: string;
  snippet?: string;
  pagemap?: {
    metatags?: Array<Record<string, string>>;
  };
}

interface GoogleSearchResponse {
  items?: GoogleSearchItem[];
}

/**
 * Google Custom Search JSON API 提供商
 * (https://developers.google.com/custom-search/v1/overview)
 */
export class GoogleWebSearchProvider extends BaseWebSearchProvider {
  readonly id = "google";
  readonly name = "Google Custom Search";

  available(env?: Record<string, unknown>): boolean {
    const key = (env?.GOOGLE_SEARCH_API_KEY || env?.GOOGLE_API_KEY) as string | undefined;
    const cx = (env?.GOOGLE_SEARCH_CX || env?.GOOGLE_CX) as string | undefined;
    return typeof key === "string" && key.length > 0 && typeof cx === "string" && cx.length > 0;
  }

  async search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    env?: Record<string, unknown>,
  ): Promise<WebSearchResult[]> {
    const apiKey =
      request.apiKey ||
      (env?.GOOGLE_SEARCH_API_KEY as string | undefined) ||
      (env?.GOOGLE_API_KEY as string | undefined);
    const cx =
      (env?.GOOGLE_SEARCH_CX as string | undefined) ||
      (env?.GOOGLE_CX as string | undefined);

    if (!apiKey || !cx) {
      return [];
    }

    const queryStr = this.resolveQueryString(request.query);
    if (!queryStr) {
      return [];
    }

    const maxResults = Math.min(10, request.maxResults ?? 5);
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(queryStr)}&num=${maxResults}`;

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        DEFAULT_SEARCH_TIMEOUT_MS,
        signal,
      );

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as GoogleSearchResponse;
      const items = Array.isArray(body.items) ? body.items : [];

      const rawResults = items.map((item) => {
        const metatag = item.pagemap?.metatags?.[0];
        const publishedDate =
          metatag?.["article:published_time"] ||
          metatag?.["og:updated_time"] ||
          metatag?.["datepublished"] ||
          metatag?.["date"];

        return this.formatResultItem({
          title: item.title,
          url: item.link,
          snippet: item.snippet,
          publishedAt: publishedDate,
        });
      });

      return this.sieveAndLimit(rawResults, queryStr, request.locale, maxResults);
    } catch {
      return [];
    }
  }
}
