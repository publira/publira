import type { PublicApiClient } from "@publira/api-client/public/client";
import { readTagRevalidatedAt } from "@publira/next-cache-handlers/tags";
import { LRUCache } from "lru-cache";

import { tenantPagesTag } from "./cache-tags";

interface PublishedPageSlugsEntry {
  /** When the read that produced `slugs` started (ms since the epoch). */
  readAt: number;
  slugs: ReadonlySet<string>;
}

/**
 * A tenant's published page slugs (`/privacy`), held per instance for the
 * proxy, where no `"use cache"` runs. A revalidation of `tenantPagesTag`, read
 * back from the shared Redis on every call, makes the next call read them
 * again; when Redis cannot be read, `ttl` bounds how stale they get.
 */
export const createPublishedPageSlugResolver = (
  publicApiClient: PublicApiClient,
  options?: {
    max?: number;
    now?: () => number;
    readRevalidatedAt?: (tag: string) => Promise<number | undefined>;
    ttl?: number;
  }
) => {
  const now = options?.now ?? (() => Temporal.Now.instant().epochMilliseconds);
  const readRevalidatedAt = options?.readRevalidatedAt ?? readTagRevalidatedAt;
  const cache = new LRUCache<string, PublishedPageSlugsEntry>({
    max: options?.max ?? 500,
    ttl: options?.ttl ?? 60_000,
  });
  const inFlight = new Map<string, Promise<PublishedPageSlugsEntry | null>>();

  const read = async (
    tenantId: string
  ): Promise<PublishedPageSlugsEntry | null> => {
    const readAt = now();
    try {
      const response = await publicApiClient.pages.listPublishedPageSlugs({
        tenant: { tenantId },
      });
      const entry = { readAt, slugs: new Set(response.slugs) };
      cache.set(tenantId, entry);
      return entry;
    } catch {
      return null;
    }
  };

  const readOnce = (tenantId: string) => {
    const pending = inFlight.get(tenantId);
    if (pending) {
      return pending;
    }
    const started = (async () => {
      try {
        return await read(tenantId);
      } finally {
        inFlight.delete(tenantId);
      }
    })();
    inFlight.set(tenantId, started);
    return started;
  };

  /** `null` when the slugs cannot be read and nothing was held. */
  return async function resolvePublishedPageSlugs(
    tenantId: string
  ): Promise<ReadonlySet<string> | null> {
    const cached = cache.get(tenantId);
    const revalidatedAt = await readRevalidatedAt(tenantPagesTag(tenantId));
    // `undefined` is a Redis that cannot be read; the entry's TTL covers it.
    if (
      cached &&
      (revalidatedAt === undefined || cached.readAt > revalidatedAt)
    ) {
      return cached.slugs;
    }

    const entry = await readOnce(tenantId);
    // A failed read keeps serving what was held rather than dropping every
    // page to the app's 404 until the API answers again.
    return entry?.slugs ?? cached?.slugs ?? null;
  };
};
