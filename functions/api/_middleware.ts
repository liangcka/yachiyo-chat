import { corsHeadersFor, preflightResponse } from "../_shared/http";

interface MiddlewareContext {
  request: Request;
  next: () => Promise<Response>;
}

/**
 * /api/* 统一 CORS 处理：
 * - APK 原生壳（origin https://localhost）跨源放行（预检 + 响应头）
 * - 其余来源不附加任何 CORS 头，维持原有的同源约束
 */
export async function onRequest(context: MiddlewareContext): Promise<Response> {
  if (context.request.method === "OPTIONS") {
    return preflightResponse(context.request);
  }

  const response = await context.next();
  const cors = corsHeadersFor(context.request);
  if (Object.keys(cors).length === 0) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
