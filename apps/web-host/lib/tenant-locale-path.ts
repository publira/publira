import type { Locale } from "@publira/i18n";

import { withLocalePrefix } from "./locale-path";
import { getTenantDefaultLocale, getTenantPublicOrigin } from "./tenant";

/** Canonical public path for a known tenant, including from Server Actions. */
export const tenantLocalePath = async (
  tenantId: string,
  currentLocale: Locale,
  href: string
): Promise<string> => {
  const defaultLocale = await getTenantDefaultLocale(tenantId);
  return withLocalePrefix(currentLocale, defaultLocale, href);
};

/**
 * The same path as an address that survives leaving the site — what a share
 * sheet hands over, and what a crawler resolves an Open Graph image against.
 *
 * `null` where the tenant's origin is unavailable, which is also the only way
 * {@link tenantLocalePath}'s read can fail: the origin is gone exactly when the
 * tenant read is, so the throw that read would otherwise raise is unreachable
 * from here.
 */
export const tenantLocaleUrl = async (
  tenantId: string,
  currentLocale: Locale,
  href: string
): Promise<string | null> => {
  const origin = await getTenantPublicOrigin(tenantId);
  if (!origin) {
    return null;
  }

  return `${origin}${await tenantLocalePath(tenantId, currentLocale, href)}`;
};
