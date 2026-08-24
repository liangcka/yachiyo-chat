const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function noStoreHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("cache-control", "no-store");
  return headers;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  initialHeaders?: HeadersInit,
): Response {
  const headers = noStoreHeaders(initialHeaders);
  headers.set("content-type", JSON_CONTENT_TYPE);

  return new Response(JSON.stringify(body), { status, headers });
}

export function problemResponse(code: string, status: number): Response {
  return jsonResponse({ error: { code } }, status);
}

export function noContentResponse(initialHeaders?: HeadersInit): Response {
  return new Response(null, {
    status: 204,
    headers: noStoreHeaders(initialHeaders),
  });
}

/** APK 原生壳（Capacitor）WebView 的固定 origin；跨源访问线上 API 依赖 CORS 放行 */
const ALLOWED_APP_ORIGINS = new Set(["https://localhost"]);

/** 同源请求，或来自放行的原生壳 origin */
export function isAllowedOrigin(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin === null) {
    return false;
  }
  return (
    suppliedOrigin === new URL(request.url).origin ||
    ALLOWED_APP_ORIGINS.has(suppliedOrigin)
  );
}

/** 是否来自放行的原生壳 origin（决定 SameSite=None cookie 与 CORS 头） */
export function isAppOriginRequest(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");
  return suppliedOrigin !== null && ALLOWED_APP_ORIGINS.has(suppliedOrigin);
}

export function corsHeadersFor(request: Request): Record<string, string> {
  if (!isAppOriginRequest(request)) {
    return {};
  }
  return {
    "access-control-allow-origin": request.headers.get("origin") as string,
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}

/** 跨源预检（POST/DELETE + JSON 请求头会触发 OPTIONS） */
export function preflightResponse(request: Request): Response {
  if (!isAppOriginRequest(request)) {
    return problemResponse("ORIGIN_NOT_ALLOWED", 403);
  }
  const headers = new Headers({
    "access-control-allow-origin": request.headers.get("origin") as string,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
  const requestedHeaders = request.headers.get("access-control-request-headers");
  if (requestedHeaders !== null) {
    headers.set("access-control-allow-headers", requestedHeaders);
  }
  return new Response(null, { status: 204, headers });
}

export function isJsonRequest(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json";
}
