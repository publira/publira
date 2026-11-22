import {
  isMissingResourceRpcError,
  isTenantSuspendedRpcError,
} from "@publira/api-client/errors";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { readTagRevalidatedAt } from "@publira/next-cache-handlers/tags";
import { LRUCache } from "lru-cache";

import { apiClient } from "./api";
import { tenantSiteCacheTag } from "./public-api";

/**
 * What the Host resolves to, as `proxy.ts` uses it.
 *
 * `tenantId` is `null` for a host no tenant claims, which the proxy answers
 * 404 for. `defaultLocale` is the tenant's saved display language, and it is
 * `null` for that same unknown host or when the API answers a code this build
 * serves no catalog for — the proxy publishes nothing then, rather than naming
 * a language it cannot render.
 */
export interface TenantRouting {
  defaultLocale: Locale | null;
  tenantId: string | null;
}

/**
 * What the Host resolves to while its tenant is suspended, which the proxy
 * answers with the page saying the console is unavailable.
 *
 * It is never cached, unlike the answer for an unknown host: the API refuses
 * the lookup for as long as the tenant is suspended and answers it again the
 * moment it is resumed, and a cached refusal would keep the console shut past
 * that moment.
 */
export const SUSPENDED_TENANT = "suspended";

const tenantRoutingCacheKey = Symbol.for("publira.web-admin.tenant-routing");

interface TenantRoutingEntry {
  /** When the lookup that produced `routing` started (ms since the epoch). */
  readAt: number;
  routing: TenantRouting;
}

/**
 * The Host resolutions `proxy.ts` rewrites from.
 *
 * The proxy and the Server Action that saves the languages are compiled into
 * separate bundles of one process. The cache lives on `globalThis`, so the
 * save drops the entries the proxy reads.
 */
const tenantRoutingCache = (): LRUCache<string, TenantRoutingEntry> => {
  // SAFETY: the property is this module's own cache, created below when absent.
  const host = globalThis as typeof globalThis &
    Record<symbol, LRUCache<string, TenantRoutingEntry> | undefined>;

  const existing = host[tenantRoutingCacheKey];

  if (existing) {
    return existing;
  }

  const created = new LRUCache<string, TenantRoutingEntry>({
    max: 500,
    ttl: 300_000,
  });

  host[tenantRoutingCacheKey] = created;

  return created;
};

/** Drops every cached Host resolution. */
export const clearTenantRoutingCache = (): void => {
  tenantRoutingCache().clear();
};

/**
 * The tenant behind the request's Host, with the display language it saved.
 *
 * The locale rides along because this is the one tenant read the console makes
 * on every request without a session. The proxy rewrites a page request from
 * an operator who chose no language onto it as the `[locale]` segment, and it
 * hands it to the browser (`@publira/utils/resolved-locale`), which is how
 * `<html lang>` and the client error boundary come to name the tenant's
 * language rather than the visitor's. A held answer is read again once
 * `tenant:<id>:site` — the tag saving the languages revalidates — was
 * revalidated after the lookup. Every process reads that time from the shared
 * Redis, so a save reaches a replica that did not handle it. When Redis cannot
 * be read, this TTL bounds how stale the answer gets. An unknown host has no
 * tag and waits out the TTL. {@link forgetTenantRouting} drops this process's
 * copy at once.
 */
export const resolveTenantRouting = async (
  domainCandidates: readonly string[]
): Promise<TenantRouting | typeof SUSPENDED_TENANT> => {
  if (domainCandidates.length === 0) {
    return { defaultLocale: null, tenantId: null };
  }

  const cache = tenantRoutingCache();
  const cacheKey = domainCandidates.join("\0");
  const cached = cache.get(cacheKey);

  if (cached !== undefined && (await isCurrentRouting(cached))) {
    return cached.routing;
  }

  const readAt = Temporal.Now.instant().epochMilliseconds;

  try {
    const response = await apiClient.auth.getTenantByDomain({
      domains: [...domainCandidates],
    });

    const routing: TenantRouting = {
      defaultLocale: parseLocale(response.defaultLocale?.trim()) ?? null,
      tenantId: response.tenantId?.trim() || null,
    };

    cache.set(cacheKey, { readAt, routing });

    return routing;
  } catch (error) {
    // Only an unknown domain is cached as "no tenant"; a transient failure
    // must not pin every request on this host to 404 for the whole TTL.
    if (isMissingResourceRpcError(error)) {
      const missing: TenantRouting = { defaultLocale: null, tenantId: null };
      cache.set(cacheKey, { readAt, routing: missing });

      return missing;
    }

    if (isTenantSuspendedRpcError(error)) {
      return SUSPENDED_TENANT;
    }

    // A held tenant whose tag moved keeps serving what was read rather than
    // taking the host down until the API answers again.
    if (cached?.routing.tenantId) {
      return cached.routing;
    }

    throw error;
  }
};

/**
 * A held routing is current until `tenant:<id>:site` is revalidated after the
 * lookup that produced it. `undefined` is a Redis that cannot be read.
 */
const isCurrentRouting = async ({
  readAt,
  routing,
}: TenantRoutingEntry): Promise<boolean> => {
  if (!routing.tenantId) {
    return true;
  }

  const revalidatedAt = await readTagRevalidatedAt(
    tenantSiteCacheTag(routing.tenantId)
  );

  return revalidatedAt === undefined || readAt > revalidatedAt;
};

/**
 * Drops this process's cached Host resolution for one tenant.
 *
 * Every process drops a copy it read before `tenant:<id>:site` was
 * revalidated. Saving the languages updates that tag, and this drops the copy
 * in the process that handled the save without waiting for the next read.
 */
export const forgetTenantRouting = (tenantId: string): void => {
  const normalized = tenantId.trim();

  if (normalized.length === 0) {
    return;
  }

  const cache = tenantRoutingCache();

  for (const [key, entry] of cache.entries()) {
    if (entry.routing.tenantId === normalized) {
      cache.delete(key);
    }
  }
};
