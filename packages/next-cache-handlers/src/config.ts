export interface CacheHandlerConfig {
  /** Full key prefix, e.g. `publira:web-host:` */
  keyPrefix: string;
  /** Redis connection URL. Empty disables Redis. */
  redisUrl: string;
  /** Per-command timeout in milliseconds. */
  timeoutMs: number;
  /** Default TTL (seconds) when an entry has no explicit revalidate/expire. */
  defaultTtlSeconds: number;
  /** Max TTL (seconds) as a safety cap for Redis keys. */
  maxTtlSeconds: number;
}

const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_TIMEOUT_MS = 1000;
// 7 days
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;
// 1 year
const MAX_TTL_SECONDS = 60 * 60 * 24 * 365;

const isProductionBuildPhase = (): boolean =>
  process.env.NEXT_PHASE === "phase-production-build";

const trimTrailingColon = (value: string): string =>
  value.endsWith(":") ? value.slice(0, -1) : value;

const isRedisDisabled = (value: string): boolean =>
  value === "" || value === "disabled" || value === "off" || value === "false";

/**
 * Resolve runtime config from environment variables.
 *
 * - `REDIS_URL` — Redis connection string (default `redis://localhost:6379`).
 *   Set to empty / `disabled` / `off` / `false` to skip Redis (cache always misses).
 * - `NEXT_CACHE_KEY_PREFIX` — full key prefix override
 * - `NEXT_CACHE_APP` — app segment in the default prefix (`publira:{app}:`)
 * - `REDIS_CACHE_TIMEOUT_MS` — command timeout (default 1000)
 */
export const resolveCacheHandlerConfig = (
  overrides: Partial<CacheHandlerConfig> = {}
): CacheHandlerConfig => {
  const rawUrl = process.env.REDIS_URL;
  let redisUrl = DEFAULT_REDIS_URL;
  if (rawUrl !== undefined) {
    const trimmed = rawUrl.trim();
    redisUrl = isRedisDisabled(trimmed) ? "" : trimmed;
  }

  // Avoid connecting Redis during `next build` (can hang CI / offline builds).
  if (isProductionBuildPhase()) {
    redisUrl = "";
  }

  const explicitPrefix = process.env.NEXT_CACHE_KEY_PREFIX?.trim();
  const app = process.env.NEXT_CACHE_APP?.trim() || "next";
  const keyPrefix = explicitPrefix
    ? `${trimTrailingColon(explicitPrefix)}:`
    : `publira:${app}:`;

  const timeoutRaw = process.env.REDIS_CACHE_TIMEOUT_MS?.trim();
  const timeoutParsed = timeoutRaw ? Number(timeoutRaw) : Number.NaN;
  const timeoutMs =
    Number.isFinite(timeoutParsed) && timeoutParsed > 0
      ? timeoutParsed
      : DEFAULT_TIMEOUT_MS;

  return {
    defaultTtlSeconds: DEFAULT_TTL_SECONDS,
    keyPrefix,
    maxTtlSeconds: MAX_TTL_SECONDS,
    redisUrl,
    timeoutMs,
    ...overrides,
  };
};

export const clampTtlSeconds = (
  seconds: number | undefined,
  config: CacheHandlerConfig
): number => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return config.defaultTtlSeconds;
  }
  return Math.min(Math.floor(seconds), config.maxTtlSeconds);
};
