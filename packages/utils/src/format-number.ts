/**
 * Locale-aware number formatting.
 *
 * The message catalog cannot do this: MessageFormat 2 functions are disabled
 * here (see `locales/README.md`), so a number reaches a message already
 * rendered as a string, and it is rendered here.
 */

import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

export interface FormatPercentOptions {
  /**
   * UI locale the value is worded in. Required for the same reason
   * `formatDateTime` requires one: the decimal separator and the position of
   * the percent sign differ per language.
   */
  locale: Locale;
  /** Digits after the decimal point. Default: 1. */
  fractionDigits?: number;
}

const percentFormatterCache = new Map<string, Intl.NumberFormat>();

const getPercentFormatter = (
  intlLocale: string,
  fractionDigits: number
): Intl.NumberFormat => {
  const key = `${intlLocale}\0${fractionDigits}`;
  const cached = percentFormatterCache.get(key);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "percent",
  });
  percentFormatterCache.set(key, formatter);
  return formatter;
};

/**
 * Format a ratio (`0.625`) as a percentage (`62.5%`).
 *
 * Takes the ratio rather than the two counts it came from: a caller holding a
 * zero denominator has to decide what to show instead of a rate, and that
 * decision is the screen's rather than the formatter's.
 */
export const formatPercent = (
  ratio: number,
  options: FormatPercentOptions
): string =>
  getPercentFormatter(
    toIntlLocale(options.locale),
    options.fractionDigits ?? 1
  ).format(ratio);
