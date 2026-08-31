import { isMissingResourceRpcError } from "@publira/api-client/errors";
import { createPublicApiClient } from "@publira/api-client/public/client";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { cacheLife, cacheTag } from "next/cache";

const publicApiClient = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? "http://localhost:8100",
  transport: "grpc",
});

interface TenantPublicInfo {
  /**
   * The tenant's stored default locale. `GetTenant` documents it as never
   * empty and resolves it against the platform default first, so `null` means
   * this build serves no catalog for the code the API answered with.
   */
  defaultLocale: Locale | null;
  name: string | null;
  theme: TenantThemeColors;
}

const applyTenantSiteCacheTag = (tenantId: string) => {
  try {
    cacheTag(`tenant:${tenantId}:site`);
  } catch {
    // Some unit tests run without Next cacheComponents runtime support.
  }
};

const getTenantPublicInfo = async (
  tenantId: string
): Promise<TenantPublicInfo | null> => {
  "use cache";
  cacheLife("hours");

  const normalized = tenantId.trim();
  if (!normalized) {
    return null;
  }

  applyTenantSiteCacheTag(normalized);

  try {
    const response = await publicApiClient.tenant.getTenant({
      tenant: { tenantId: normalized },
    });

    return {
      defaultLocale: parseLocale(response.defaultLocale.trim()) ?? null,
      name: response.tenantName?.trim() || null,
      theme: resolveTenantThemeColors(response.theme),
    };
  } catch (error) {
    if (!isMissingResourceRpcError(error)) {
      // Console chrome only — the tenant name in `<title>` and the theme
      // colours. Both are resolved before a static shell exists, where a throw
      // from a `"use cache"` fill answers a bare 500 for the whole route
      // instead of reaching any boundary (#672). The entry is dropped, so the
      // real name and theme come back as soon as the public API does.
      console.warn("[web-admin] getTenantPublicInfo failed", error);
      dropFailedCacheEntry();
    }
    return null;
  }
};

export const getTenantName = async (
  tenantId: string
): Promise<string | null> => {
  const info = await getTenantPublicInfo(tenantId);
  return info?.name ?? null;
};

export const getTenantThemeColors = async (
  tenantId: string
): Promise<TenantThemeColors | null> => {
  const info = await getTenantPublicInfo(tenantId);
  return info?.theme ?? null;
};

/**
 * The tenant's default UI locale, or `null` when it cannot be read.
 *
 * This is what an unauthenticated console screen renders in: the login form has
 * no operator to have a cookie yet, and the admin API's own
 * `GetTenantDefaultLocale` needs the session that screen exists to create.
 * `GetTenant` answers the same stored value without one, and the read carries
 * `tenant:<id>:site`, which the admin API revalidates when the setting is saved
 * (`tenantDefaultLocaleRevalidateTags`), so a change reaches the console as
 * soon as it reaches the site.
 *
 * Use this only where `null` has an answer of its own — `<html lang>`, which
 * says nothing rather than naming a language it did not resolve. Everything
 * that renders copy wants {@link getTenantDisplayLocale}.
 */
export const findTenantDisplayLocale = async (
  tenantId: string
): Promise<Locale | null> => {
  const info = await getTenantPublicInfo(tenantId);
  return info?.defaultLocale ?? null;
};

/**
 * The tenant's default UI locale.
 *
 * Throws when the tenant cannot be read, or names a locale this build serves no
 * catalog for. The console has no second language to offer: rendering the
 * operator a page in one nobody chose would hide the outage behind chrome that
 * looks like it worked.
 */
export const getTenantDisplayLocale = async (
  tenantId: string
): Promise<Locale> => {
  const defaultLocale = await findTenantDisplayLocale(tenantId);
  if (!defaultLocale) {
    throw new Error(`tenant default locale is unavailable: ${tenantId}`);
  }

  return defaultLocale;
};
