import type { ClientChatRequest, ClientHistoryMessage } from "../validation";
import { shouldSearchWeb } from "./intent";
import { searchWeb } from "./orchestrator";
import { enrichWithPageContent } from "./page-content";
import { buildSearchQueries } from "./query";
import type { WebSearchResult } from "./types";

export type SearchNeedJudge = (
  messages: readonly ClientHistoryMessage[],
  signal?: AbortSignal,
) => Promise<boolean | null>;

export interface WebSearchPipelineOptions {
  judge?: SearchNeedJudge;
  signal?: AbortSignal;
  env?: Record<string, unknown>;
}

/**
 * 联网搜索全流程编排管线：
 * 1. 仅在 chat 模式且 webSearch === true 时执行；
 * 2. 意图判断：若提供 judge 回调则执行模型意图判断；若模型明确判定 YES 则放行；若 verdict !== true 则回退规则门控 shouldSearchWeb；
 * 3. 查询词构建：buildSearchQueries(request.messages)，若为空（如纯图片）返回 undefined；
 * 4. 搜索执行：searchWeb({ query, locale, signal, smart, env })；若返回空数组返回 undefined（静默降级为普通对话）；
 * 5. 正文增强：enrichWithPageContent(results, locale, signal)。
 */
export async function performWebSearchPipeline(
  request: ClientChatRequest,
  options?: WebSearchPipelineOptions,
): Promise<readonly WebSearchResult[] | undefined> {
  if (request.webSearch !== true || request.mode === "summary") {
    return undefined;
  }

  const signal = options?.signal;

  let verdict: boolean | null = null;
  if (options?.judge) {
    try {
      verdict = await options.judge(request.messages, signal);
    } catch {
      verdict = null;
    }
  }

  // 模型明确输出 NO 或判断失败(null)时，仅在规则门控未命中时跳过搜索；若规则明确命中或模型判定 YES 则放行搜索
  if (verdict !== true && !shouldSearchWeb(request.messages)) {
    return undefined;
  }

  const queries = buildSearchQueries(request.messages);
  if (queries.length === 0) {
    return undefined;
  }

  const results = await searchWeb({
    query: queries,
    locale: request.locale,
    signal,
    smart: request.smartSearch === true,
    env: options?.env,
  });

  if (results.length === 0) {
    return undefined;
  }

  return enrichWithPageContent(results, request.locale, signal);
}
