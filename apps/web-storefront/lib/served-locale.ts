import { getLocaleLabel, isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

/**
 * The locale a public read says its text was taken from. A page, a series, and
 * an episode each fall back on their own — the reader's locale, then the
 * tenant's default, then the oldest translation — so the answer names the one
 * it served.
 *
 * An unreadable served locale is treated as the one the reader asked for: the
 * text still renders, and it does not claim a fallback it cannot name.
 */
export const servedLocaleFrom = (
  locale: string | undefined,
  requestedLocale: Locale
): Locale => (isLocale(locale) ? locale : requestedLocale);

/**
 * The locales a read says the text has a translation in, the served one
 * included, in the order the read named them and without a code this build
 * does not know.
 */
export const publishedLocalesFrom = (
  codes: readonly string[] | undefined,
  servedLocale: Locale
): readonly Locale[] => {
  const locales: Locale[] = [];
  const seen = new Set<Locale>();

  const add = (code: string) => {
    if (!isLocale(code) || seen.has(code)) {
      return;
    }

    seen.add(code);
    locales.push(code);
  };

  for (const code of codes ?? []) {
    add(code);
  }

  // The served translation exists by definition, even when the list of
  // alternates omitted it because the tenant no longer offers its locale.
  add(servedLocale);

  return locales;
};

/**
 * The autonym of the language a text is shown in when that is not the language
 * the reader asked for, or `null` when the requested translation was served.
 *
 * The name comes from the locale registry — the same autonym the language
 * switcher shows — so the sentence around it is the only part the catalog owns.
 */
export const fallbackLanguage = (
  requestedLocale: Locale,
  servedLocale: Locale
): string | null =>
  requestedLocale === servedLocale ? null : getLocaleLabel(servedLocale);
