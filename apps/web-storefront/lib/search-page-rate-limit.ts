import { setTimeout } from "node:timers/promises";

import { createClient } from "redis";

/**
 * The Valkey or Redis the counters are shared through, the variable
 * `publira server` keeps its own rate limit counters in.
 */
export const REDIS_URL_ENV = "PUBLIRA_REDIS_URL";

/** How long one exchange with the shared counters may take before it is skipped. */
const SHARED_COUNTER_TIMEOUT_MILLISECONDS = 1000;

/** Keeps the counters apart from everything else sharing the server. */
const KEY_PREFIX = "publira:rl:search-page:";

/**
 * The window the search page counts a client's requests over: the 10 seconds
 * `publira server` counts its anonymous reads over.
 */
export const SEARCH_PAGE_WINDOW_SECONDS = 10;

/**
 * What the edge admits from one client on the search page: 20 at once, and 2
 * a second after that (**Request rates** in `infra/proxy/README.md`).
 */
export const EDGE_SEARCH_PAGE_RATE = { burst: 20, perSecond: 2 } as const;

/**
 * How many requests for the search page one client may send in a window:
 * twice what the edge admits in one, the headroom `publira server` keeps over
 * the edge on the search procedures, so that a reader behind a working edge is
 * refused by the edge first.
 */
export const SEARCH_PAGE_LIMIT =
  2 *
  (EDGE_SEARCH_PAGE_RATE.burst +
    EDGE_SEARCH_PAGE_RATE.perSecond * SEARCH_PAGE_WINDOW_SECONDS);

/** The verdict on one request: refused ones carry the wait, in whole seconds. */
export type SearchPageDecision =
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

/**
 * The counters in the Valkey or Redis {@link REDIS_URL_ENV} names.
 *
 * The client connects in the background and reconnects on its own, and a
 * request never waits for it: until it is ready, and whenever it is not, the
 * request is counted in the process alone. The expiry is set only on the
 * request that creates a key, so a later one in the same window cannot push
 * its end further out.
 */
const createRedisCounter = (): SharedCounter => {
  let client: RedisClient | null | undefined;
  let unreachable = false;

  const connected = (): RedisClient | null => {
    if (client === undefined) {
      let url: string | null = null;

      try {
        url = parseRedisUrl(process.env[REDIS_URL_ENV]);
      } catch (error) {
        console.error(
          "[web-storefront] the shared search page counters are refused; counting in this process",
          error
        );
      }

      client = url ? createClient({ disableOfflineQueue: true, url }) : null;

      client?.on("error", (error: Error) => {
        if (!unreachable) {
          unreachable = true;
          console.warn(
            "[web-storefront] the shared search page counters are unreachable; counting in this process",
            error
          );
        }
      });
      client?.on("ready", () => {
        unreachable = false;
      });
      // A failed connect is reported by the error event above.
      client?.connect().catch(() => null);
    }

    return client?.isReady ? client : null;
  };

  const chargeShared: SharedCounter = async (key, ttlSeconds) => {
    const redis = connected();

    if (!redis) {
      return null;
    }

    const replies = await withinTimeout(
      redis
        .multi()
        .incr(`${KEY_PREFIX}${key}`)
        .expire(`${KEY_PREFIX}${key}`, ttlSeconds, "NX")
        .execTyped()
    );

    return replies?.[0] ?? null;
  };

  return chargeShared;
};

interface SearchPageLimiterOptions {
  /** The current time in epoch milliseconds. */
  now?: () => number;
  shared?: SharedCounter;
}

/**
 * Counts requests for the search page per client, over fixed windows of
 * {@link SEARCH_PAGE_WINDOW_SECONDS}.
 *
 * `publira server` cannot count them: the page runs the search from this
 * process, as itself, for every reader at once. Every instance of
 * `web-storefront` counts a client together through the shared counters, and
 * this process keeps its own beside them, so a store that stops answering
 * narrows the limit to one instance rather than removing it. The count is the
 * higher of the two, since this instance can only have seen part of what
 * every instance together has.
 */
export const createSearchPageLimiter = ({
  now = () => Temporal.Now.instant().epochMilliseconds,
  shared = createRedisCounter(),
}: SearchPageLimiterOptions = {}) => {
  const windowMilliseconds = SEARCH_PAGE_WINDOW_SECONDS * 1000;
  let currentWindow = -1;
  // Only the current window's counts are kept, so the map holds no more
  // clients than sent a request in the last window.
  let local = new Map<string, number>();

  return async (client: string): Promise<SearchPageDecision> => {
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

    return count > SEARCH_PAGE_LIMIT
      ? { allowed: false, retryAfterSeconds }
      : { allowed: true };
  };
};
