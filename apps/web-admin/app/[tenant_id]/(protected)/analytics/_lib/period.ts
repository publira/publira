import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamDate } from "@publira/utils/search-params";
import { z } from "zod";

/**
 * How many of the tenant's days a report covers when the URL names none: four
 * whole weeks, so every weekday is in it the same number of times, and the
 * same window the read-through report is counted over.
 */
export const DEFAULT_PERIOD_DAYS = 28;

/** The longest period the statistics RPCs accept. */
export const MAX_PERIOD_DAYS = 366;

/** Inclusive calendar days (`YYYY-MM-DD`) of the tenant. */
export interface AnalyticsPeriodDates {
  start: string;
  end: string;
}

/**
 * The period a screen reports, or why the one the URL names cannot be. A
 * refused period keeps its dates, so the form still shows what was asked for.
 */
export type AnalyticsPeriod =
  | ({ ok: true } & AnalyticsPeriodDates)
  | ({ ok: false; reason: "reversed" | "too_long" } & AnalyticsPeriodDates);

/**
 * `from` and `to` as the period form submits them. A value that is not a
 * calendar day is dropped to `""`, which {@link resolveAnalyticsPeriod} fills
 * from the default, so an unusable URL still renders a report.
 */
const periodSearchParamsSchema = z.object({
  from: searchParamDate({ fallback: "" }),
  to: searchParamDate({ fallback: "" }),
});

export const parsePeriodSearchParams = (input: {
  from?: SearchParamValue;
  to?: SearchParamValue;
}): { from: string; to: string } => periodSearchParamsSchema.parse(input);

/**
 * The period a report covers, in the tenant's days.
 *
 * Without dates it is the {@link DEFAULT_PERIOD_DAYS} days ending yesterday in
 * `timeZone`: today is still under way, and views and reactions reach a day
 * only once its statistics have been built, so a period ending today would end
 * on a day that looks quiet. A missing end is yesterday, or the start when that
 * is later, and a missing start is the default length before the end.
 */
export const resolveAnalyticsPeriod = (
  input: { from: string; to: string },
  timeZone: string,
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(timeZone)
): AnalyticsPeriod => {
  const yesterday = today.subtract({ days: 1 });
  const from = input.from ? Temporal.PlainDate.from(input.from) : null;
  const to = input.to ? Temporal.PlainDate.from(input.to) : null;

  let end = to ?? yesterday;
  if (!to && from && Temporal.PlainDate.compare(from, end) > 0) {
    end = from;
  }
  const start = from ?? end.subtract({ days: DEFAULT_PERIOD_DAYS - 1 });
  const dates = { end: end.toString(), start: start.toString() };

  if (Temporal.PlainDate.compare(start, end) > 0) {
    return { ...dates, ok: false, reason: "reversed" };
  }
  if (start.until(end, { largestUnit: "days" }).days + 1 > MAX_PERIOD_DAYS) {
    return { ...dates, ok: false, reason: "too_long" };
  }
  return { ...dates, ok: true };
};
