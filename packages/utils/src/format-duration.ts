import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

/** How wide the units are written: "23 hours" or "23 hr". */
export type DurationStyle = "long" | "short";

export interface FormatDurationOptions {
  /** UI locale the duration is worded in. */
  locale: Locale;
  /** Default: `long`. */
  style?: DurationStyle;
}

const numberFormatterCache = new Map<string, Intl.NumberFormat>();

const getUnitFormatter = (
  intlLocale: string,
  unit: "hour" | "minute",
  style: DurationStyle
): Intl.NumberFormat => {
  const key = `${intlLocale}\0${unit}\0${style}`;
  const cached = numberFormatterCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(intlLocale, {
    style: "unit",
    unit,
    unitDisplay: style,
  });
  numberFormatterCache.set(key, formatter);
  return formatter;
};

const listFormatterCache = new Map<string, Intl.ListFormat>();

const getUnitListFormatter = (
  intlLocale: string,
  style: DurationStyle
): Intl.ListFormat => {
  const key = `${intlLocale}\0${style}`;
  const cached = listFormatterCache.get(key);
  if (cached) {
    return cached;
  }
  // `narrow` joins "5 hr" and "12 min" with a space alone, which is how a
  // short duration is written; `long` says "5 hours, 12 minutes".
  const formatter = new Intl.ListFormat(intlLocale, {
    style: style === "long" ? "long" : "narrow",
    type: "unit",
  });
  listFormatterCache.set(key, formatter);
  return formatter;
};

/**
 * Format a span of whole hours and minutes: "23 hours", "5 hr 12 min".
 *
 * The units and their plurals come from `Intl`, not from the message catalog,
 * because a catalog message cannot select a plural form: "1 hours" is what a
 * `{$hours} hours` message says for one. A zero part is left out, and a span
 * of no time at all is "0 minutes" rather than an empty string.
 *
 * This is `Intl.DurationFormat` assembled from the formatters every supported
 * runtime and TypeScript library already carry.
 */
export const formatDuration = (
  duration: { hours?: number; minutes?: number },
  options: FormatDurationOptions
): string => {
  const intlLocale = toIntlLocale(options.locale);
  const style = options.style ?? "long";
  const hours = Math.max(0, Math.trunc(duration.hours ?? 0));
  const minutes = Math.max(0, Math.trunc(duration.minutes ?? 0));

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(getUnitFormatter(intlLocale, "hour", style).format(hours));
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(getUnitFormatter(intlLocale, "minute", style).format(minutes));
  }
  return getUnitListFormatter(intlLocale, style).format(parts);
};
