import type { Locale } from "@publira/i18n";

import { withLocalePrefix } from "./locale-path";
import { getTenantDefaultLocale } from "./tenant";

/** Canonical public path for a known tenant, including from Server Actions. */
export const tenantLocalePath = async (
  tenantId: string,
  currentLocale: Locale,
  href: string
): Promise<string> => {
  const defaultLocale = await getTenantDefaultLocale(tenantId);
  return withLocalePrefix(currentLocale, defaultLocale, href);
};
