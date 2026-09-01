import { isMissingResourceRpcError } from "@publira/api-client/errors";
import type { PublicApiClient } from "@publira/api-client/public/client";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LRUCache } from "lru-cache";

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

const toResolvedTenant = (
  defaultLocale: string,
  tenantId: string
): ResolvedTenant => {
  const locale = parseLocale(defaultLocale);
  if (locale === undefined) {
    throw new Error(
      `tenant default locale is not supported: ${defaultLocale} (${tenantId})`
    );
  }

  return { defaultLocale: locale, tenantId };
};

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
      // the platform setting itself, so a value that fails to parse is one this
      // build does not serve. The proxy redirects a locale-less URL to this
      // code, and there is no second choice worth sending a reader to.
      const tenant = tenantId
        ? toResolvedTenant(response.defaultLocale, tenantId)
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
