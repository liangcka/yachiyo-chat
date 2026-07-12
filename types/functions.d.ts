interface KVNamespacePutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
}

interface KVNamespaceListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

interface KVNamespaceListResult {
  keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
  list_complete: boolean;
  cursor?: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult>;
}

interface YachiyoEnvironment {
  APP_MODE?: "live" | "mock";
  ACCESS_CODE_SHA256: string;
  SESSION_SIGNING_SECRET: string;
  STEPFUN_API_KEY: string;
  STEPFUN_BASE_URL: string;
  STEPFUN_MODEL: string;
  DAILY_REQUEST_LIMIT: string;
  AUTH_ATTEMPT_LIMIT: string;
  RATE_LIMIT_KV: KVNamespace;
}

interface Env extends YachiyoEnvironment {
  readonly __yachiyoEnvironmentBrand?: never;
}

declare namespace Cloudflare {
  interface Env extends YachiyoEnvironment {
    readonly __yachiyoEnvironmentBrand?: never;
  }
}
