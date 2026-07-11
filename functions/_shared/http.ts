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
