import {
  isMissingResourceRpcError,
  isTenantSuspendedRpcError,
} from "@publira/api-client/errors";
import type { PublicApiClient } from "@publira/api-client/public/client";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { readTagRevalidatedAt } from "@publira/next-cache-handlers/tags";
import { LRUCache } from "lru-cache";

import { tenantSiteTag } from "./cache-tags";
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
  /** When the lookup that produced `tenant` started (ms since the epoch). */
  readAt: number;
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

/** The one call the resolver makes to the public API. */
interface TenantLookupClient {
  domain: Pick<PublicApiClient["domain"], "getTenantByDomain">;
}

/**
 * The tenant each set of Host candidates resolves to, held per instance for
 * the proxy, where no `"use cache"` runs.
 *
 * The locales ride on the answer, so a held tenant is read again once its
 * `tenant:<id>:site` tag — which the admin API revalidates when the languages
 * are saved — is revalidated after the lookup started: the proxy then agrees
 * with the switcher about which prefixes the site serves. The tag's time is
 * read back from the shared Redis on every call; when Redis cannot be read,
 * `ttl` bounds how stale the answer gets. An unknown host has no tag and
 * waits out `ttl`.
 */
export const createTenantResolver = (
  publicApiClient: TenantLookupClient,
  options?: {
    max?: number;
    now?: () => number;
    readRevalidatedAt?: (tag: string) => Promise<number | undefined>;
    ttl?: number;
  }
) => {
  const now = options?.now ?? (() => Temporal.Now.instant().epochMilliseconds);
  const readRevalidatedAt = options?.readRevalidatedAt ?? readTagRevalidatedAt;

  const tenantCache = new LRUCache<string, TenantCacheValue>({
    max: options?.max ?? 500,
    ttl: options?.ttl ?? 300_000,
  });

  const isCurrent = async ({
    readAt,
    tenant,
  }: TenantCacheValue): Promise<boolean> => {
    if (!tenant) {
      return true;
    }

    const revalidatedAt = await readRevalidatedAt(
      tenantSiteTag(tenant.tenantId)
    );

    // `undefined` is a Redis that cannot be read; the entry's TTL covers it.
    return revalidatedAt === undefined || readAt > revalidatedAt;
  };

  return async function resolveTenant(
    domainCandidates: readonly string[]
  ): Promise<ResolvedTenant | typeof SUSPENDED_TENANT | null> {
    if (domainCandidates.length === 0) {
      return null;
    }

    const cacheKey = domainCandidates.join("\0");
    const cached = tenantCache.get(cacheKey);

    if (cached !== undefined && (await isCurrent(cached))) {
      return cached.tenant;
    }

    const readAt = now();

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

      tenantCache.set(cacheKey, { readAt, tenant });

      return tenant;
    } catch (error) {
      // Only an unknown domain is cached as "no tenant"; a transient failure
      // must not pin every request on this host to 404 for the whole TTL.
      if (isMissingResourceRpcError(error)) {
        tenantCache.set(cacheKey, { readAt, tenant: null });

        return null;
      }

      if (isTenantSuspendedRpcError(error)) {
        return SUSPENDED_TENANT;
      }

      // A held tenant whose tag moved keeps serving what was read rather than
      // taking the host down until the API answers again.
      if (cached?.tenant) {
        return cached.tenant;
      }

      throw error;
    }
  };
};
