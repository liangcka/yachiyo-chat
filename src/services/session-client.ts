export type SessionClientErrorCode =
  | "ACCESS_DENIED"
  | "AUTH_RATE_LIMITED"
  | "INVALID_REQUEST"
  | "ORIGIN_NOT_ALLOWED"
  | "CONFIGURATION_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "ABORTED";

export class SessionClientError extends Error {
  constructor(
    readonly code: SessionClientErrorCode,
    readonly status?: number,
  ) {
    super(code);
    this.name = "SessionClientError";
  }
}

const knownServerCodes = new Set<SessionClientErrorCode>([
  "ACCESS_DENIED",
  "AUTH_RATE_LIMITED",
  "INVALID_REQUEST",
  "ORIGIN_NOT_ALLOWED",
  "CONFIGURATION_ERROR",
  "SERVICE_UNAVAILABLE",
]);

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

async function problemCode(response: Response): Promise<SessionClientErrorCode> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const error = (body as Record<string, unknown>).error;
      if (typeof error === "object" && error !== null) {
        const code = (error as Record<string, unknown>).code;
        if (typeof code === "string" && knownServerCodes.has(code as SessionClientErrorCode)) {
          return code as SessionClientErrorCode;
        }
      }
    }
  } catch {
    // Malformed server responses are intentionally collapsed to a stable code.
  }
  return "SERVICE_UNAVAILABLE";
}

export class SessionClient {
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch) {
    this.fetcher = (input, init) => fetcher(input, init);
  }

  async check(signal?: AbortSignal): Promise<boolean> {
    const response = await this.request("GET", undefined, signal);
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        typeof (body as Record<string, unknown>).authenticated === "boolean"
      ) {
        return (body as { authenticated: boolean }).authenticated;
      }
    } catch {
      // Fall through to a stable service error.
    }
    throw new SessionClientError("SERVICE_UNAVAILABLE", response.status);
  }

  async authenticate(accessCode: string, signal?: AbortSignal): Promise<void> {
    await this.request("POST", JSON.stringify({ accessCode }), signal);
  }

  async signOut(signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", undefined, signal);
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    body: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    try {
      const response = await this.fetcher("/api/session", {
        ...(body === undefined ? {} : { body, headers: { "content-type": "application/json" } }),
        credentials: "same-origin",
        method,
        signal,
      });
      if (!response.ok) {
        throw new SessionClientError(await problemCode(response), response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof SessionClientError) throw error;
      throw new SessionClientError(isAbort(error, signal) ? "ABORTED" : "NETWORK_ERROR");
    }
  }
}
