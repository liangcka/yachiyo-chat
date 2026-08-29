import { shouldSearchWeb } from "./intent";
import { maximumSmartResults, maximumStandardResults } from "./merge";
import {
  defaultSearchOrchestrator,
  SearchOrchestrator,
  searchWeb,
  type SearchOptions,
  type SearchOrchestratorOptions,
} from "./orchestrator";
import {
  performWebSearchPipeline,
  type SearchNeedJudge,
  type WebSearchPipelineOptions,
} from "./pipeline";
import { buildSearchQueries, buildSearchQuery } from "./query";
import type { EnrichedChatRequest, WebSearchResult } from "./types";

export {
  performWebSearchPipeline,
  SearchOrchestrator,
  defaultSearchOrchestrator,
  searchWeb,
  shouldSearchWeb,
  buildSearchQueries,
  buildSearchQuery,
  maximumSmartResults,
  maximumStandardResults,
};

export type {
  SearchOptions,
  SearchOrchestratorOptions,
  WebSearchPipelineOptions,
  SearchNeedJudge,
  EnrichedChatRequest,
  WebSearchResult,
};
