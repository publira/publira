import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

export interface FormatListOptions {
  /** UI locale the list is worded in. */
  locale: Locale;
}

const listFormatterCache = new Map<string, Intl.ListFormat>();

const getListFormatter = (intlLocale: string): Intl.ListFormat => {
  const cached = listFormatterCache.get(intlLocale);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.ListFormat(intlLocale);
  listFormatterCache.set(intlLocale, formatter);
  return formatter;
};

/** Format a list of display strings using the UI locale's conventions. */
export const formatList = (
  values: Iterable<string>,
  options: FormatListOptions
): string => getListFormatter(toIntlLocale(options.locale)).format(values);
