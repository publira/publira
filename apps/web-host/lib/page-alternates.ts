import { getLocale } from "./locale";
import type { LocaleAlternates } from "./locale-path";
import { getTenantId } from "./tenant-id";
import { tenantLocaleAlternates } from "./tenant-locale-path";

/** {@link tenantLocaleAlternates} for the tenant and locale being rendered. */
export const getPageAlternates = async (
  href: string
): Promise<LocaleAlternates | undefined> => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  return tenantLocaleAlternates(tenantId, locale, href);
};
