import { getProvider } from "./providers/registry";
import type { EnrichedChatRequest } from "./web-search";

export interface GlmConfiguration {
  endpoint: string;
  apiKey: string;
  model: "glm-4.7-flash";
}

export function resolveGlmConfiguration(
  env: Pick<Env, "GLM_API_KEY" | "GLM_BASE_URL" | "GLM_MODEL">,
): GlmConfiguration | null {
  if (
    typeof env.GLM_API_KEY !== "string" ||
    env.GLM_API_KEY.length === 0 ||
    env.GLM_API_KEY.length > 512 ||
    env.GLM_API_KEY !== env.GLM_API_KEY.trim() ||
    env.GLM_MODEL !== "glm-4.7-flash"
  ) {
    return null;
  }

  try {
    const baseUrl = new URL(env.GLM_BASE_URL);
    const pathname = baseUrl.pathname.replace(/\/+$/u, "");
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.hostname !== "open.bigmodel.cn" ||
      baseUrl.port !== "" ||
      baseUrl.username !== "" ||
      baseUrl.password !== "" ||
      baseUrl.search !== "" ||
      baseUrl.hash !== "" ||
      pathname !== "/api/paas/v4"
    ) {
      return null;
    }

    return {
      endpoint: `${baseUrl.origin}${pathname}/chat/completions`,
      apiKey: env.GLM_API_KEY,
      model: "glm-4.7-flash",
    };
  } catch {
    return null;
  }
}

export async function requestGlm(
  request: EnrichedChatRequest,
  configuration: GlmConfiguration,
  signal: AbortSignal,
): Promise<Response> {
  const provider = getProvider("glm");
  const built = provider.buildRequest({
    request,
    apiKey: configuration.apiKey,
    model: configuration.model,
  });
  return fetch(configuration.endpoint, {
    method: "POST",
    headers: built.headers,
    body: built.body,
    signal,
  });
}
