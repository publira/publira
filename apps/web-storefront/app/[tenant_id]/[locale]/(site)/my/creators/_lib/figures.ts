import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { formatPercent } from "@publira/utils";

/**
 * The share of member views that ended in a completion, as the console's
 * read-through report words it, or `null` when nothing was viewed: a rate over
 * no views is not zero, and the page shows a dash in its place.
 */
export const formatReadThroughRate = (
  completeCount: number,
  memberViewCount: number,
  locale: Locale
): string | null =>
  memberViewCount > 0
    ? formatPercent(completeCount / memberViewCount, { locale })
    : null;

/** A credit's share for display, as the console's statement shows it: `30%`. */
export const formatShareBps = (bps: number, locale: Locale): string =>
  new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 2,
    style: "percent",
  }).format(bps / 10_000);

/** A count for display, grouped as the reader's locale groups digits. */
export const formatCount = (count: number, locale: Locale): string =>
  new Intl.NumberFormat(toIntlLocale(locale)).format(count);
