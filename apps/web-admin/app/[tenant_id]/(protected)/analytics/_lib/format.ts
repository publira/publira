import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

const countFormatters = new Map<string, Intl.NumberFormat>();
const ratingFormatters = new Map<string, Intl.NumberFormat>();

const formatterFor = (
  cache: Map<string, Intl.NumberFormat>,
  locale: Locale,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat => {
  const intlLocale = toIntlLocale(locale);
  let formatter = cache.get(intlLocale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(intlLocale, options);
    cache.set(intlLocale, formatter);
  }
  return formatter;
};

/**
 * A count in a figure or a table cell, grouped the way `locale` groups digits,
 * since a report's views and followers run to thousands. A count inside a
 * sentence is formatted by the message instead (`:integer`).
 */
export const formatCount = (value: number, locale: Locale): string =>
  formatterFor(countFormatters, locale, { maximumFractionDigits: 0 }).format(
    value
  );

/** A rating on the 1-5 scale, to the one decimal the API rounds it to. */
export const formatRating = (value: number, locale: Locale): string =>
  formatterFor(ratingFormatters, locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value);
