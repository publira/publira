import type { Locale } from "@publira/i18n";

import { localeAlternates, withLocalePrefix } from "./locale-path";
import type { LocaleAlternates } from "./locale-path";
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
 * sheet hands over. Metadata needs no such address: `metadataBase` resolves
 * its relative URLs.
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

/**
 * {@link localeAlternates} for a known tenant, ready for a page's `alternates`.
 *
 * `undefined` exactly where the root layout has no `metadataBase` to resolve
 * these paths against — the tenant's origin is unavailable — since Next.js
 * would otherwise write them against `localhost`. A page that puts other
 * relative URLs in its metadata gates them on the same answer.
 */
export const tenantLocaleAlternates = async (
  tenantId: string,
  currentLocale: Locale,
  href: string
): Promise<LocaleAlternates | undefined> => {
  const origin = await getTenantPublicOrigin(tenantId);
  if (!origin) {
    return undefined;
  }

  const defaultLocale = await getTenantDefaultLocale(tenantId);
  return localeAlternates(currentLocale, defaultLocale, href);
};
