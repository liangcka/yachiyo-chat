import type { ClientChatRequest } from "../validation";

/** 单条网页搜索结果（来自必应 RSS 的一个 item） */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 发布日期（YYYY-MM-DD，UTC）；RSS 缺失或解析失败时省略 */
  publishedAt?: string;
  /** 页面正文摘录（抓取成功且比摘要更有信息量时存在，替代 snippet 注入） */
  content?: string;
}

/**
 * 服务端校验后才允许附加的聊天请求类型。
 * searchResults 不在校验白名单内，客户端 JSON 无法伪造注入。
 */
export type EnrichedChatRequest = ClientChatRequest & {
  searchResults?: readonly WebSearchResult[];
};
