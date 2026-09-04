import { clampTtlSeconds, resolveCacheHandlerConfig } from "./config";
import type { CacheHandlerConfig } from "./config";
import { withRedis } from "./redis-client";
import {
  bufferToStream,
  deserializeCachePayload,
  serializeCachePayload,
  streamToBuffer,
} from "./serialize";

/**
 * Shape of Next.js `"use cache"` / `"use cache: remote"` handler entries.
 * Mirrored from `next/dist/server/lib/cache-handlers/types` to avoid a hard
 * runtime dependency on Next internals.
 */
export interface UseCacheEntry {
  value: ReadableStream<Uint8Array>;
  tags: string[];
  stale: number;
  timestamp: number;
  expire: number;
  revalidate: number;
}

export interface UseCacheHandler {
  get: (
    cacheKey: string,
    softTags: string[]
  ) => Promise<UseCacheEntry | undefined>;
  set: (
    cacheKey: string,
    pendingEntry: Promise<UseCacheEntry>
  ) => Promise<void>;
  refreshTags: () => Promise<void>;
  getExpiration: (tags: string[]) => Promise<number>;
  updateTags: (
    tags: string[],
    durations?: { expire?: number }
  ) => Promise<void>;
}

interface StoredUseCacheEntry {
  valueBase64: string;
  tags: string[];
  stale: number;
  timestamp: number;
  expire: number;
  revalidate: number;
}

const entryKey = (prefix: string, cacheKey: string): string =>
  `${prefix}uc:v:${cacheKey}`;

const tagKey = (prefix: string, tag: string): string =>
  `${prefix}uc:tag:${tag}`;

const tagIndexKey = (prefix: string): string => `${prefix}uc:revalidated-tags`;

/**
 * When a tag was revalidated, and how long the values it had already tagged may
 * still be served.
 *
 * `revalidateTag(tag, profile)` states the second one: the profile's `expire`
 * is the window during which a request is answered from the previous value
 * while a new one is produced. Collapsing the two into a single timestamp is
 * what the `"max"` profile turns into a year-long outage — `staleAt` a year
 * ahead would mark every entry written in that year as invalid, including the
 * ones written to replace the revalidated value.
 */
interface TagRevalidation {
  /** Entries older than this are stale and must be revalidated. */
  staleAt: number;
  /** When a stale entry stops being served at all. */
  expiredAt: number;
}

/**
 * A value written by a deployment that stored the bare timestamp is dropped
 * rather than guessed at: it cannot say which of the two moments it meant, and
 * the tag is recorded again the next time anything revalidates it.
 */
const parseTagRevalidation = (raw: string): TagRevalidation | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const { expiredAt, staleAt } = parsed as Partial<TagRevalidation>;
  if (typeof staleAt !== "number" || typeof expiredAt !== "number") {
    return undefined;
  }
  if (!(Number.isFinite(staleAt) && Number.isFinite(expiredAt))) {
    return undefined;
  }
  return { expiredAt, staleAt };
};

const applyTagRevalidations = (
  tags: string[],
  values: (string | null)[],
  target: Map<string, TagRevalidation>
): void => {
  for (const [index, tag] of tags.entries()) {
    const raw = values[index];
    if (raw === null || raw === undefined) {
      continue;
    }
    const revalidation = parseTagRevalidation(raw);
    if (revalidation) {
      target.set(tag, revalidation);
    }
  }
};

export const createUseCacheHandler = (
  configOverrides: Partial<CacheHandlerConfig> = {}
): UseCacheHandler => {
  const config = resolveCacheHandlerConfig(configOverrides);
  /** Local mirror of tag revalidations (ms), refreshed from Redis. */
  const localTagRevalidations = new Map<string, TagRevalidation>();

  const maxExpiredAt = (tags: string[]): number => {
    let max = 0;
    for (const tag of tags) {
      const expiredAt = localTagRevalidations.get(tag)?.expiredAt ?? 0;
      if (expiredAt > max) {
        max = expiredAt;
      }
    }
    return max;
  };

  const isStaleByTags = (tags: string[], entryTimestamp: number): boolean =>
    tags.some(
      (tag) => (localTagRevalidations.get(tag)?.staleAt ?? 0) > entryTimestamp
    );

  /**
   * The entry predates a revalidation whose serve-stale window has run out.
   * A window still open leaves the entry servable, which is the whole point of
   * `revalidateTag(tag, "max")`: readers keep seeing the previous value while
   * the next request produces the new one.
   */
  const isExpiredByTags = (
    tags: string[],
    entryTimestamp: number,
    now: number
  ): boolean =>
    tags.some((tag) => {
      const revalidation = localTagRevalidations.get(tag);
      return (
        revalidation !== undefined &&
        revalidation.expiredAt <= now &&
        revalidation.expiredAt > entryTimestamp
      );
    });

  const get: UseCacheHandler["get"] = async (cacheKey, softTags) => {
    // Only complete Redis writes are visible; in-flight sets simply miss.
    const stored = await withRedis(config, null, async (client) => {
      const raw = await client.get(entryKey(config.keyPrefix, cacheKey));
      if (!raw) {
        return null;
      }
      return deserializeCachePayload<StoredUseCacheEntry>(raw);
    });

    if (!stored) {
      return;
    }

    const now = Date.now();
    // Production: treat past-revalidate as miss (same spirit as Next default).
    // Dev keeps serving until expire so HMR reloads stay fast.
    const maxAgeSeconds = process.env.__NEXT_DEV_SERVER
      ? stored.expire
      : stored.revalidate;

    if (now > stored.timestamp + maxAgeSeconds * 1000) {
      return;
    }

    if (now > stored.timestamp + stored.expire * 1000) {
      return;
    }

    if (
      isExpiredByTags(stored.tags, stored.timestamp, now) ||
      isExpiredByTags(softTags, stored.timestamp, now)
    ) {
      return;
    }

    // `-1` is how Next.js asks for a revalidation while this value is served,
    // the same signal its own default handler returns for a stale tag.
    const isStale =
      isStaleByTags(stored.tags, stored.timestamp) ||
      isStaleByTags(softTags, stored.timestamp);

    const bytes = Buffer.from(stored.valueBase64, "base64");
    return {
      expire: stored.expire,
      revalidate: isStale ? -1 : stored.revalidate,
      stale: stored.stale,
      tags: stored.tags,
      timestamp: stored.timestamp,
      value: bufferToStream(bytes),
    };
  };

  const set: UseCacheHandler["set"] = async (cacheKey, pendingEntry) => {
    const entry = await pendingEntry;

    if (!process.env.__NEXT_DEV_SERVER && entry.expire === 0) {
      return;
    }

    const [forCaller, forStore] = entry.value.tee();
    entry.value = forCaller;

    let bytes: Uint8Array;
    try {
      bytes = await streamToBuffer(forStore);
    } catch {
      // Partial / errored stream: do not persist.
      return;
    }

    const stored: StoredUseCacheEntry = {
      expire: entry.expire,
      revalidate: entry.revalidate,
      stale: entry.stale,
      tags: entry.tags,
      timestamp: entry.timestamp,
      valueBase64: Buffer.from(bytes).toString("base64"),
    };

    const ttl = clampTtlSeconds(entry.expire, config);

    await withRedis(config, undefined, async (client) => {
      await client.set(
        entryKey(config.keyPrefix, cacheKey),
        serializeCachePayload(stored),
        {
          EX: ttl,
        }
      );
    });
  };

  const refreshTags: UseCacheHandler["refreshTags"] = async () => {
    await withRedis(config, undefined, async (client) => {
      const tags = await client.sMembers(tagIndexKey(config.keyPrefix));
      if (tags.length === 0) {
        return;
      }
      const keys = tags.map((tag) => tagKey(config.keyPrefix, tag));
      const values = await client.mGet(keys);
      applyTagRevalidations(tags, values, localTagRevalidations);
    });
  };

  const getExpiration: UseCacheHandler["getExpiration"] = (tags) =>
    Promise.resolve(maxExpiredAt(tags));

  const updateTags: UseCacheHandler["updateTags"] = async (tags, durations) => {
    if (tags.length === 0) {
      return;
    }
    const now = Date.now();
    // No window given means the caller wants the previous value gone now,
    // which is also what the deprecated one-argument `revalidateTag` asks for.
    const revalidation: TagRevalidation = {
      expiredAt:
        durations?.expire === undefined ? now : now + durations.expire * 1000,
      staleAt: now,
    };

    for (const tag of tags) {
      localTagRevalidations.set(tag, revalidation);
    }

    await withRedis(config, undefined, async (client) => {
      const multi = client.multi();
      for (const tag of tags) {
        multi.set(tagKey(config.keyPrefix, tag), JSON.stringify(revalidation));
        multi.sAdd(tagIndexKey(config.keyPrefix), tag);
      }
      await multi.exec();
    });
  };

  return {
    get,
    getExpiration,
    refreshTags,
    set,
    updateTags,
  };
};
