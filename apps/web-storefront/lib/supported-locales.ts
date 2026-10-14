import { getLocales, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

/**
 * The locales a tenant's site offers, as `GetTenant` and `GetTenantByDomain`
 * answer them, in registry order and always holding `defaultLocale`.
 *
 * Both RPCs fail rather than answer a stored code the platform does not serve,
 * so a code that fails to parse here is one this build has no catalog for. It
 * throws, the way an unparseable default does: serving the rest would hide the
 * mismatch behind a site missing a language the tenant chose.
 */
export const toSupportedLocales = (
  codes: readonly string[],
  defaultLocale: Locale
): Locale[] => {
  const offered = new Set<Locale>([defaultLocale]);
  for (const code of codes) {
    const locale = parseLocale(code);
    if (locale === undefined) {
      throw new Error(`tenant supported locale is not supported: ${code}`);
    }
    offered.add(locale);
  }

  return getLocales().filter((locale) => offered.has(locale));
};
