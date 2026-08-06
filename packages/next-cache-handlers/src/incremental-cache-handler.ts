import { clampTtlSeconds, resolveCacheHandlerConfig } from "./config";
import type { CacheHandlerConfig } from "./config";
import { withRedis } from "./redis-client";
import { deserializeCachePayload, serializeCachePayload } from "./serialize";

/**
 * Minimal types for Next.js singular `cacheHandler` (ISR / fetch / image).
 * Kept loose so we do not pin to Next private module paths at compile time.
 */
export interface IncrementalCacheHandlerContext {
  fs?: unknown;
  dev?: boolean;
  flushToDisk?: boolean;
  serverDistDir?: string;
  maxMemoryCacheSize?: number;
  fetchCacheKeyPrefix?: string;
  prerenderManifest?: unknown;
  revalidatedTags: string[];
  _requestHeaders: Record<string, undefined | string | string[]>;
}

export interface IncrementalCacheHandlerValue {
  lastModified: number;
  age?: number;
  cacheState?: string;
  value: unknown;
  tags?: string[];
}

export interface IncrementalSetContext {
  tags?: string[];
  fetchCache?: boolean;
  cacheControl?: {
    revalidate?: number | false;
    expire?: number;
  };
  isFallback?: boolean;
  isRoutePPREnabled?: boolean;
  fetchUrl?: string;
  fetchIdx?: number;
  isImplicitBuildTimeCache?: boolean;
}

const CACHE_TAGS_HEADER = "x-next-cache-tags";

interface StoredIncrementalEntry {
  lastModified: number;
  tags: string[];
  value: unknown;
}

const valueKey = (prefix: string, key: string): string =>
  `${prefix}inc:v:${key}`;

const tagTimestampKey = (prefix: string, tag: string): string =>
  `${prefix}inc:tag:${tag}`;

const tagKeysKey = (prefix: string, tag: string): string =>
  `${prefix}inc:tagkeys:${tag}`;

const extractTagsFromValue = (
  data: unknown,
  ctx: IncrementalSetContext
): string[] => {
  const tags = new Set<string>();

  if (ctx.tags) {
    for (const tag of ctx.tags) {
      if (tag) {
        tags.add(tag);
      }
    }
  }

  if (data && typeof data === "object" && "tags" in data) {
    const { tags: dataTags } = data as { tags?: string[] };
    if (Array.isArray(dataTags)) {
      for (const tag of dataTags) {
        if (tag) {
          tags.add(tag);
        }
      }
    }
  }

  if (data && typeof data === "object" && "headers" in data) {
    const { headers } = data as { headers?: Record<string, unknown> };
    const headerVal =
      headers?.[CACHE_TAGS_HEADER] ?? headers?.["X-Next-Cache-Tags"];
    if (typeof headerVal === "string" && headerVal.length > 0) {
      for (const tag of headerVal.split(",")) {
        const trimmed = tag.trim();
        if (trimmed) {
          tags.add(trimmed);
        }
      }
    }
  }

  return [...tags];
};

const resolveTtlSeconds = (
  data: unknown,
  ctx: IncrementalSetContext,
  config: CacheHandlerConfig
): number => {
  if (
    data &&
    typeof data === "object" &&
    "kind" in data &&
    (data as { kind?: string }).kind === "IMAGE" &&
    "revalidate" in data &&
    typeof (data as { revalidate?: number }).revalidate === "number"
  ) {
    return clampTtlSeconds((data as { revalidate: number }).revalidate, config);
  }

  const revalidate = ctx.cacheControl?.revalidate;
  if (typeof revalidate === "number" && revalidate > 0) {
    return clampTtlSeconds(revalidate, config);
  }

  if (
    data &&
    typeof data === "object" &&
    "revalidate" in data &&
    typeof (data as { revalidate?: number }).revalidate === "number"
  ) {
    return clampTtlSeconds((data as { revalidate: number }).revalidate, config);
  }

  return config.defaultTtlSeconds;
};

const areTagsExpired = (
  tags: string[],
  lastModified: number,
  tagTimestamps: Map<string, number>
): boolean => {
  for (const tag of tags) {
    const expiredAt = tagTimestamps.get(tag);
    if (expiredAt !== undefined && expiredAt > lastModified) {
      return true;
    }
  }
  return false;
};

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

/**
 * Next.js expects a **class** default export for `cacheHandler` (singular).
 * Instances share Redis via the module-level client pool.
 */
export class RedisIncrementalCacheHandler {
  private readonly config: CacheHandlerConfig;
  private readonly revalidatedTags: string[];
  /** Per-request tag timestamp mirror; refreshed in revalidateTag / get as needed. */
  private readonly localTagTimestamps = new Map<string, number>();

  constructor(
    ctx: IncrementalCacheHandlerContext,
    configOverrides: Partial<CacheHandlerConfig> = {}
  ) {
    this.config = resolveCacheHandlerConfig(configOverrides);
    this.revalidatedTags = ctx.revalidatedTags ?? [];
  }

  resetRequestCache(): void {
    // No durable per-request memory tier; drop local tag mirror for the next request.
    this.localTagTimestamps.clear();
  }

  async get(
    cacheKey: string,
    ctx?: { kind?: string; tags?: string[]; softTags?: string[] }
  ): Promise<IncrementalCacheHandlerValue | null> {
    const stored = await withRedis(this.config, null, async (client) => {
      const raw = await client.get(valueKey(this.config.keyPrefix, cacheKey));
      if (!raw) {
        return null;
      }
      return deserializeCachePayload<StoredIncrementalEntry>(raw);
    });

    if (!stored) {
      return null;
    }

    const combined = [
      ...new Set([
        ...(stored.tags ?? []),
        ...(ctx?.softTags ?? []),
        ...(ctx?.tags ?? []),
      ]),
    ];

    if (combined.some((tag) => this.revalidatedTags.includes(tag))) {
      return null;
    }

    const missing = combined.filter((tag) => !this.localTagTimestamps.has(tag));
    if (missing.length > 0) {
      await this.hydrateTagTimestamps(missing);
    }

    if (
      areTagsExpired(combined, stored.lastModified, this.localTagTimestamps)
    ) {
      return null;
    }

    return {
      lastModified: stored.lastModified,
      tags: stored.tags,
      value: stored.value,
    };
  }

  async set(
    cacheKey: string,
    data: unknown | null,
    ctx: IncrementalSetContext = {}
  ): Promise<void> {
    if (data === null) {
      await withRedis(this.config, undefined, async (client) => {
        await client.del(valueKey(this.config.keyPrefix, cacheKey));
      });
      return;
    }

    const tags = extractTagsFromValue(data, ctx);
    const lastModified = Date.now();
    const stored: StoredIncrementalEntry = {
      lastModified,
      tags,
      value: data,
    };
    const ttl = resolveTtlSeconds(data, ctx, this.config);
    const key = valueKey(this.config.keyPrefix, cacheKey);

    await withRedis(this.config, undefined, async (client) => {
      const multi = client.multi();
      multi.set(key, serializeCachePayload(stored), { EX: ttl });
      for (const tag of tags) {
        multi.sAdd(tagKeysKey(this.config.keyPrefix, tag), cacheKey);
      }
      await multi.exec();
    });
  }

  async revalidateTag(
    tags: string | string[],
    durations?: { expire?: number }
  ): Promise<void> {
    const list = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
    if (list.length === 0) {
      return;
    }

    const now = Date.now();
    const expireAt =
      durations?.expire === undefined ? now : now + durations.expire * 1000;

    for (const tag of list) {
      this.localTagTimestamps.set(tag, expireAt);
    }

    await withRedis(this.config, undefined, async (client) => {
      const multi = client.multi();
      for (const tag of list) {
        multi.set(
          tagTimestampKey(this.config.keyPrefix, tag),
          String(expireAt)
        );
      }
      await multi.exec();

      const membersByTag = await Promise.all(
        list.map(async (tag) => {
          const keys = await client.sMembers(
            tagKeysKey(this.config.keyPrefix, tag)
          );
          return { keys, tag };
        })
      );

      const delMulti = client.multi();
      for (const { keys, tag } of membersByTag) {
        for (const k of keys) {
          delMulti.del(valueKey(this.config.keyPrefix, k));
        }
        delMulti.del(tagKeysKey(this.config.keyPrefix, tag));
      }
      await delMulti.exec();
    });
  }

  private async hydrateTagTimestamps(tags: string[]): Promise<void> {
    await withRedis(this.config, undefined, async (client) => {
      const keys = tags.map((tag) =>
        tagTimestampKey(this.config.keyPrefix, tag)
      );
      const values = await client.mGet(keys);
      applyTagTimestamps(tags, values, this.localTagTimestamps);
    });
  }
}
