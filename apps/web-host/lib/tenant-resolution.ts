import { isMissingResourceRpcError } from "@publira/api-client/errors";
import type { PublicApiClient } from "@publira/api-client/public/client";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LRUCache } from "lru-cache";

import { FALLBACK_LOCALE } from "./fallback-locale";

/**
 * What the Host resolves to.
 *
 * `defaultLocale` rides along because `GetTenantByDomain` returns it: the
 * proxy has to answer a URL with no locale prefix with a redirect, and the
 * language that redirect picks is the tenant's setting, not a constant of this
 * app. Carrying it here keeps that to the one round trip the domain lookup
 * already makes.
 */
export interface ResolvedTenant {
  defaultLocale: Locale;
  tenantId: string;
}

interface TenantCacheValue {
  tenant: ResolvedTenant | null;
}

export const createTenantResolver = (
  publicApiClient: PublicApiClient,
  options?: {
    max?: number;
    ttl?: number;
  }
) => {
  const tenantCache = new LRUCache<string, TenantCacheValue>({
    max: options?.max ?? 500,
    ttl: options?.ttl ?? 300_000,
  });

  return async function resolveTenant(
    domainCandidates: readonly string[]
  ): Promise<ResolvedTenant | null> {
    if (domainCandidates.length === 0) {
      return null;
    }

    const cacheKey = domainCandidates.join("\0");
    const cached = tenantCache.get(cacheKey);
    if (cached !== undefined) {
      return cached.tenant;
    }

    try {
      const response = await publicApiClient.domain.getTenantByDomain({
        domains: [...domainCandidates],
      });
      const tenantId = response.tenantId?.trim() || null;
      // The API documents `default_locale` as never empty, and falls back to
      // the platform setting itself. `parseLocale` only catches a value this
      // build does not serve.
      const tenant = tenantId
        ? {
            defaultLocale:
              parseLocale(response.defaultLocale) ?? FALLBACK_LOCALE,
            tenantId,
          }
        : null;
      tenantCache.set(cacheKey, { tenant });
      return tenant;
    } catch (error) {
      // Only an unknown domain is cached as "no tenant"; a transient failure
      // must not pin every request on this host to 404 for the whole TTL.
      if (isMissingResourceRpcError(error)) {
        tenantCache.set(cacheKey, { tenant: null });
        return null;
      }

      throw error;
    }
  };
};
