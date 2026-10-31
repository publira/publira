import { parseInstant } from "@publira/utils";
import { z } from "zod";

import type { EpisodePublicationItem } from "#lib/publishing-calendar";

/**
 * A month as the calendar's URL names it, `YYYY-MM`. Four digits for the year
 * because that is the only form {@link shiftCalendarMonth} writes back: a year
 * past 9999 would be `+010000-01`.
 */
export const calendarMonthSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);

const firstDayOf = (month: string): Temporal.PlainDate =>
  Temporal.PlainDate.from(`${month}-01`);

/** The day `now` falls on in `timeZone`, `YYYY-MM-DD`. */
export const todayIn = (
  timeZone: string,
  now: Temporal.Instant = Temporal.Now.instant()
): string => now.toZonedDateTimeISO(timeZone).toPlainDate().toString();

/** The month `now` falls in, counted in `timeZone`. */
export const currentCalendarMonth = (
  timeZone: string,
  now: Temporal.Instant = Temporal.Now.instant()
): string => todayIn(timeZone, now).slice(0, "YYYY-MM".length);

/** The month `months` away from `month`, backwards for a negative count. */
export const shiftCalendarMonth = (month: string, months: number): string =>
  firstDayOf(month).add({ months }).toPlainYearMonth().toString();

/** The first and the last day of `month`, as the period the API reads. */
export const calendarMonthPeriod = (
  month: string
): { endDate: string; startDate: string } => {
  const first = firstDayOf(month);

  return {
    endDate: first.add({ months: 1 }).subtract({ days: 1 }).toString(),
    startDate: first.toString(),
  };
};

/**
 * The days of `month` as the rows of a grid, Sunday first, the order the
 * console's weekly schedule lists weekdays in. The first and the last row are
 * padded with `null` where the days belong to the months around it.
 */
export const calendarMonthWeeks = (month: string): (string | null)[][] => {
  const first = firstDayOf(month);

  const cells: (string | null)[] = Array.from(
    // `dayOfWeek` counts Monday as 1 and Sunday as 7.
    { length: first.dayOfWeek % 7 },
    () => null
  );

  for (let day = 0; day < first.daysInMonth; day += 1) {
    cells.push(first.add({ days: day }).toString());
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: (string | null)[][] = [];

  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return weeks;
};

/**
 * The episodes of each day they go out on in `timeZone`, keyed `YYYY-MM-DD`,
 * each day in the order the episodes were given. An episode whose time cannot
 * be read has no day to be put on, and is left out.
 */
export const groupByDay = (
  episodes: readonly EpisodePublicationItem[],
  timeZone: string
): Map<string, EpisodePublicationItem[]> => {
  const days = Map.groupBy(
    episodes,
    (episode) =>
      parseInstant(episode.publishedAt)
        ?.toZonedDateTimeISO(timeZone)
        .toPlainDate()
        .toString() ?? ""
  );

  days.delete("");

  return days;
};
