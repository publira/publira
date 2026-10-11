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

export interface FormatPriceOptions {
  /** ISO 4217 code of the currency the amount is in, as the API names it. */
  currency: string;
  /** UI locale the amount is worded in: the sign and the separators differ. */
  locale: Locale;
}

const priceFormatterCache = new Map<string, Intl.NumberFormat>();

const getPriceFormatter = (
  intlLocale: string,
  currency: string
): Intl.NumberFormat => {
  const key = `${intlLocale}\0${currency}`;
  const cached = priceFormatterCache.get(key);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(intlLocale, {
    currency,
    style: "currency",
  });
  priceFormatterCache.set(key, formatter);
  return formatter;
};

/**
 * How many digits of `currency` follow the decimal point, which is how many
 * places its minor unit — the unit every amount the API sends is an integer
 * of — sits below the currency itself: 0 for JPY, 2 for USD.
 */
export const currencyFractionDigits = (currency: string): number =>
  getPriceFormatter("en", currency).resolvedOptions().maximumFractionDigits ??
  0;

const currencyNamesCache = new Map<string, Intl.DisplayNames>();

/**
 * The name of `currency` in the UI locale, such as `US Dollar`, for a list an
 * operator chooses a currency from. A code the runtime has no name for is its
 * own name.
 */
export const currencyDisplayName = (
  currency: string,
  options: { locale: Locale }
): string => {
  const intlLocale = toIntlLocale(options.locale);
  let names = currencyNamesCache.get(intlLocale);
  if (!names) {
    names = new Intl.DisplayNames(intlLocale, {
      fallback: "code",
      type: "currency",
    });
    currencyNamesCache.set(intlLocale, names);
  }
  return names.of(currency) ?? currency;
};

let cachedCurrencies: readonly string[] | undefined;

/**
 * ISO 4217 codes of the currencies the runtime knows, sorted by code, for a
 * list an operator chooses one from. It is the option list rather than the
 * definition of a valid value: the Go server decides what it stores, and a
 * code listed here can still be refused there.
 *
 * Memoized, as `listSupportedTimeZones` is: the list changes only with the
 * runtime's ICU data.
 */
export const listSupportedCurrencies = (): readonly string[] => {
  cachedCurrencies ??= Intl.supportedValuesOf("currency").toSorted();
  return cachedCurrencies;
};

/**
 * Format an amount the API sends — an integer in the minor unit of
 * `currency` — as that currency: `500` is `¥500` in JPY and `$5.00` in USD.
 */
export const formatPrice = (
  amount: number,
  options: FormatPriceOptions
): string =>
  getPriceFormatter(toIntlLocale(options.locale), options.currency).format(
    amount / 10 ** currencyFractionDigits(options.currency)
  );
