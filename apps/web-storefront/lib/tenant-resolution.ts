import {
  isMissingResourceRpcError,
  isTenantSuspendedRpcError,
} from "@publira/api-client/errors";
import type { PublicApiClient } from "@publira/api-client/public/client";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LRUCache } from "lru-cache";

import { toSupportedLocales } from "./supported-locales";

/**
 * What the Host resolves to.
 *
 * `defaultLocale` and `supportedLocales` ride along because
 * `GetTenantByDomain` returns them: the proxy decides which locale a URL is
 * served in, and which prefixes it serves at all, from the tenant's settings
 * rather than from constants of this app. Carrying them here keeps that to the
 * one round trip the domain lookup already makes.
 */
export interface ResolvedTenant {
  defaultLocale: Locale;
  /** In registry order, and always holding `defaultLocale`. */
  supportedLocales: readonly Locale[];
  tenantId: string;
}

/**
 * What the Host resolves to while its tenant is suspended.
 *
 * It is never cached, unlike the answer for an unknown host: the API refuses
 * the lookup for as long as the tenant is suspended and answers it again the
 * moment it is resumed, and a cached refusal would keep the site down past
 * that moment.
 */
export const SUSPENDED_TENANT = "suspended";

interface TenantCacheValue {
  tenant: ResolvedTenant | null;
}

const toResolvedTenant = (
  defaultLocale: string,
  supportedLocales: readonly string[],
  tenantId: string
): ResolvedTenant => {
  const locale = parseLocale(defaultLocale);
  if (locale === undefined) {
    throw new Error(
      `tenant default locale is not supported: ${defaultLocale} (${tenantId})`
    );
  }

  return {
    defaultLocale: locale,
    supportedLocales: toSupportedLocales(supportedLocales, locale),
    tenantId,
  };
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
  ): Promise<ResolvedTenant | typeof SUSPENDED_TENANT | null> {
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
        ? toResolvedTenant(
            response.defaultLocale,
            response.supportedLocales ?? [],
            tenantId
          )
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
      if (isTenantSuspendedRpcError(error)) {
        return SUSPENDED_TENANT;
      }

      throw error;
    }
  };
};
