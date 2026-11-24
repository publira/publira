import { setTimeout } from "node:timers/promises";

import { createClient } from "redis";

/**
 * The Valkey or Redis the counters are shared through, the variable
 * `publira server` keeps its own rate limit counters in.
 */
export const REDIS_URL_ENV = "PUBLIRA_REDIS_URL";

/** How long one exchange with the shared counters may take before it is skipped. */
const SHARED_COUNTER_TIMEOUT_MILLISECONDS = 1000;

/**
 * The window a limit counts a client's requests over: the 10 seconds
 * `publira server` counts its anonymous reads over.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 10;

/** The verdict on one request: refused ones carry the wait, in whole seconds. */
export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Adds one to the counter every instance shares at `key`, which expires after
 * `ttlSeconds`, and answers the new count, or `null` when there is no shared
 * store to count in.
 */
export type SharedCounter = (
  key: string,
  ttlSeconds: number
) => Promise<number | null>;

/**
 * The URL {@link REDIS_URL_ENV} names, or `null` when it names none, read the
 * way `publira server` reads it: empty, `disabled`, `off`, and `false` turn
 * the shared counters off, and a `redis://` URL carrying a password is
 * refused, since that scheme would send it in cleartext on every connect.
 */
export const parseRedisUrl = (raw: string | undefined): string | null => {
  const value = (raw ?? "").trim();

  if (["", "disabled", "false", "off"].includes(value.toLowerCase())) {
    return null;
  }

  if (URL.canParse(value)) {
    const url = new URL(value);

    if (url.protocol === "redis:" && url.password !== "") {
      throw new Error(
        `${REDIS_URL_ENV} carries a password over redis://, which is sent in cleartext; use rediss:// instead`
      );
    }
  }

  return value;
};

type RedisClient = ReturnType<typeof createClient>;

/**
 * `work`'s answer, or `null` once {@link SHARED_COUNTER_TIMEOUT_MILLISECONDS}
 * have passed or when it fails.
 */
const withinTimeout = async <T>(work: Promise<T>): Promise<T | null> => {
  const timer = new AbortController();

  const expired = setTimeout(SHARED_COUNTER_TIMEOUT_MILLISECONDS, null, {
    signal: timer.signal,
  }).catch(() => null);

  try {
    return await Promise.race([work.catch(() => null), expired]);
  } finally {
    timer.abort();
  }
};

let redisClient: RedisClient | null | undefined;
let redisUnreachable = false;

/**
 * The one connection every limit in this process counts through, or `null`
 * while it is not ready or when there is no store to connect to.
 *
 * The client connects in the background on first use and reconnects on its
 * own, and a request never waits for it: until it is ready, and whenever it is
 * not, the request is counted in the process alone.
 */
const connectedRedis = (): RedisClient | null => {
  if (redisClient === undefined) {
    let url: string | null = null;

    try {
      url = parseRedisUrl(process.env[REDIS_URL_ENV]);
    } catch (error) {
      console.error(
        "[web-storefront] the shared rate limit counters are refused; counting in this process",
        error
      );
    }

    redisClient = url ? createClient({ disableOfflineQueue: true, url }) : null;

    redisClient?.on("error", (error: Error) => {
      if (!redisUnreachable) {
        redisUnreachable = true;
        console.warn(
          "[web-storefront] the shared rate limit counters are unreachable; counting in this process",
          error
        );
      }
    });
    redisClient?.on("ready", () => {
      redisUnreachable = false;
    });
    // A failed connect is reported by the error event above.
    redisClient?.connect().catch(() => null);
  }

  return redisClient?.isReady ? redisClient : null;
};

/**
 * The counters of one limit in the Valkey or Redis {@link REDIS_URL_ENV}
 * names, under a key prefix of its own. The expiry is set only on the request
 * that creates a key, so a later one in the same window cannot push its end
 * further out.
 */
const createRedisCounter =
  (name: string): SharedCounter =>
  async (key, ttlSeconds) => {
    const redis = connectedRedis();

    if (!redis) {
      return null;
    }

    const redisKey = `publira:rl:${name}:${key}`;

    const replies = await withinTimeout(
      redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, ttlSeconds, "NX")
        .execTyped()
    );

    return replies?.[0] ?? null;
  };

export interface RequestRateLimiterOptions {
  /**
   * What the limit counts, which keeps its counters apart from every other
   * limit's in the shared store.
   */
  name: string;
  /** How many requests one client may send in a window. */
  limit: number;
  /** The current time in epoch milliseconds. */
  now?: () => number;
  /** The counters every instance shares; the Valkey or Redis by default. */
  shared?: SharedCounter;
}

/**
 * Counts requests per client over fixed windows of
 * {@link RATE_LIMIT_WINDOW_SECONDS}, for a request `publira server` cannot
 * count itself because this process makes the call behind it.
 *
 * Every instance of `web-storefront` counts a client together through the
 * shared counters, and this process keeps its own beside them, so a store
 * that stops answering narrows the limit to one instance rather than removing
 * it. The count is the higher of the two, since this instance can only have
 * seen part of what every instance together has.
 */
export const createRequestRateLimiter = ({
  limit,
  name,
  now = () => Temporal.Now.instant().epochMilliseconds,
  shared = createRedisCounter(name),
}: RequestRateLimiterOptions) => {
  const windowMilliseconds = RATE_LIMIT_WINDOW_SECONDS * 1000;
  let currentWindow = -1;
  // Only the current window's counts are kept, so the map holds no more
  // clients than sent a request in the last window.
  let local = new Map<string, number>();

  return async (client: string): Promise<RateLimitDecision> => {
    const at = now();
    const window = Math.floor(at / windowMilliseconds);

    if (window !== currentWindow) {
      currentWindow = window;
      local = new Map();
    }

    const localCount = (local.get(client) ?? 0) + 1;
    local.set(client, localCount);

    const remainingMilliseconds = (window + 1) * windowMilliseconds - at;
    const retryAfterSeconds = Math.ceil(remainingMilliseconds / 1000);

    let sharedCount: number | null = null;

    try {
      sharedCount = await shared(`${window}:${client}`, retryAfterSeconds);
    } catch {
      // A store that drops the exchange counts nothing for this request, and
      // the client's error event has said why; the in-process count still
      // does.
    }

    const count = Math.max(localCount, sharedCount ?? 0);

    return count > limit
      ? { allowed: false, retryAfterSeconds }
      : { allowed: true };
  };
};
