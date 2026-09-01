import { isMissingResourceRpcError } from "@publira/api-client/errors";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LRUCache } from "lru-cache";

import { apiClient } from "./api";

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

const tenantCache = new LRUCache<string, TenantRouting>({
  max: 500,
  ttl: 300_000,
});

/**
 * The tenant behind the request's Host, with the display language it saved.
 *
 * The locale rides along because this is the one tenant read the console makes
 * on every request without a session: the proxy hands it to the browser
 * (`@publira/utils/resolved-locale`), which is how `<html lang>` and the client
 * error boundary come to name the tenant's language rather than the visitor's.
 * The console screens resolve the same setting for themselves through
 * `lib/public-api.ts`, so nothing downstream reads the published copy back —
 * which is what keeps the cache below harmless. A saved default that changes
 * reaches the copy on screen at once, through the `tenant:<id>:site` tag the
 * admin API revalidates, and reaches `<html lang>` within this TTL.
 */
export const resolveTenantRouting = async (
  domainCandidates: readonly string[]
): Promise<TenantRouting> => {
  if (domainCandidates.length === 0) {
    return { defaultLocale: null, tenantId: null };
  }

  const cacheKey = domainCandidates.join("\0");
  const cached = tenantCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await apiClient.auth.getTenantByDomain({
      domains: [...domainCandidates],
    });
    const routing: TenantRouting = {
      defaultLocale: parseLocale(response.defaultLocale?.trim()) ?? null,
      tenantId: response.tenantId?.trim() || null,
    };
    tenantCache.set(cacheKey, routing);
    return routing;
  } catch (error) {
    // Only an unknown domain is cached as "no tenant"; a transient failure
    // must not pin every request on this host to 404 for the whole TTL.
    if (isMissingResourceRpcError(error)) {
      const missing: TenantRouting = { defaultLocale: null, tenantId: null };
      tenantCache.set(cacheKey, missing);
      return missing;
    }

    throw error;
  }
};
