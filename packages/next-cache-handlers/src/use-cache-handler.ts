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

const applyTagTimestamps = (
  tags: string[],
  values: (string | null)[],
  target: Map<string, number>
): void => {
  for (const [index, tag] of tags.entries()) {
    const raw = values[index];
    if (raw === null || raw === undefined) {
      continue;
    }
    const ts = Number(raw);
    if (Number.isFinite(ts)) {
      target.set(tag, ts);
    }
  }
};

export const createUseCacheHandler = (
  configOverrides: Partial<CacheHandlerConfig> = {}
): UseCacheHandler => {
  const config = resolveCacheHandlerConfig(configOverrides);
  /** Local mirror of tag revalidation timestamps (ms), refreshed from Redis. */
  const localTagTimestamps = new Map<string, number>();

  const maxTagTimestamp = (tags: string[]): number => {
    let max = 0;
    for (const tag of tags) {
      const ts = localTagTimestamps.get(tag) ?? 0;
      if (ts > max) {
        max = ts;
      }
    }
    return max;
  };

  const isStaleByTags = (tags: string[], entryTimestamp: number): boolean =>
    maxTagTimestamp(tags) > entryTimestamp;

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

    if (isStaleByTags(stored.tags, stored.timestamp)) {
      return;
    }

    if (isStaleByTags(softTags, stored.timestamp)) {
      return;
    }

    const bytes = Buffer.from(stored.valueBase64, "base64");
    return {
      expire: stored.expire,
      revalidate: stored.revalidate,
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
      applyTagTimestamps(tags, values, localTagTimestamps);
    });
  };

  const getExpiration: UseCacheHandler["getExpiration"] = (tags) =>
    Promise.resolve(maxTagTimestamp(tags));

  const updateTags: UseCacheHandler["updateTags"] = async (tags, durations) => {
    if (tags.length === 0) {
      return;
    }
    const now = Date.now();
    const expireAt =
      durations?.expire === undefined ? now : now + durations.expire * 1000;

    for (const tag of tags) {
      localTagTimestamps.set(tag, expireAt);
    }

    await withRedis(config, undefined, async (client) => {
      const multi = client.multi();
      for (const tag of tags) {
        multi.set(tagKey(config.keyPrefix, tag), String(expireAt));
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
