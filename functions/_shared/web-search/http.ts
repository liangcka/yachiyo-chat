import type { ChatLocale } from "../validation";

export interface BingMarket {
  readonly mkt: string;
  readonly setlang: string;
  readonly acceptLanguage: string;
}

/** 按界面语言锁定必应市场与请求语言，避免出口网络被误判为其他市场（如日语） */
export const localeMarket: Record<ChatLocale, BingMarket> = {
  "zh-CN": { mkt: "zh-CN", setlang: "zh-hans", acceptLanguage: "zh-CN,zh;q=0.9" },
  "ja-JP": { mkt: "ja-JP", setlang: "ja", acceptLanguage: "ja-JP,ja;q=0.9" },
};

/** 智能搜索的国际路市场：中文内容池索引滞后（SEO 镜像站多），en-US 市场能命中权威新信息 */
export const internationalMarket: BingMarket = {
  mkt: "en-US",
  setlang: "en",
  acceptLanguage: "en-US,en;q=0.9",
};

export const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * 带超时与外部信号联动的 fetch：
 * 内部 AbortController 在 timeoutMs 后触发；调用方传入的 signal 中断时同步联动。
 * 只负责超时与中断控制，不吞错误——各调用方的降级策略不同（返回 [] / 原结果 / null），
 * 由调用方自行 try/catch。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();

  if (signal !== undefined && signal.aborted) {
    controller.abort();
  }
  signal?.addEventListener("abort", forwardAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
