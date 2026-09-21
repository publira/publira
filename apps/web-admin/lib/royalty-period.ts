import { z } from "zod";

/**
 * A royalty month as the API names it, `YYYY-MM`. Months compare correctly as
 * strings in this shape, which is what every helper below relies on.
 */
export const royaltyPeriodSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);

export type RoyaltyCloseMode = "automatic" | "manual";

export interface RoyaltyClosePolicy {
  closeMode: RoyaltyCloseMode;
  /** Day 1–28 of the following month; set only in automatic mode. */
  autoCloseDay?: number;
  /** When automatic closing was last enabled, as RFC 3339; empty if never. */
  automaticSince: string;
}

const firstDayOf = (period: string): Temporal.PlainDate =>
  Temporal.PlainDate.from(`${period}-01`);

const toPeriod = (day: Temporal.PlainDate): string =>
  day.toPlainYearMonth().toString();

/** The month `now` falls in, counted in `timeZone`. */
export const currentRoyaltyPeriod = (
  timeZone: string,
  now: Temporal.Instant = Temporal.Now.instant()
): string => toPeriod(now.toZonedDateTimeISO(timeZone).toPlainDate());

/** The month `months` away from `period`, backwards for a negative count. */
export const shiftRoyaltyPeriod = (period: string, months: number): string =>
  toPeriod(firstDayOf(period).add({ months }));

/** The last calendar day of the month, `YYYY-MM-DD`. */
export const royaltyPeriodLastDay = (period: string): string =>
  firstDayOf(period).add({ months: 1 }).subtract({ days: 1 }).toString();

/** The instant the month ends in `timeZone`: midnight starting the next one. */
const royaltyPeriodEnd = (period: string, timeZone: string): Temporal.Instant =>
  firstDayOf(period).add({ months: 1 }).toZonedDateTime(timeZone).toInstant();

/** Whether the month has ended in `timeZone`, so it can be closed. */
export const isRoyaltyPeriodOver = (
  period: string,
  timeZone: string,
  now: Temporal.Instant = Temporal.Now.instant()
): boolean =>
  Temporal.Instant.compare(now, royaltyPeriodEnd(period, timeZone)) >= 0;

/**
 * Whether the batch closes this month rather than a person: the tenant is in
 * automatic mode and the month ended after that mode was switched on. A month
 * that ended before it stays a manual close, which is what the batch skips.
 */
export const closesAutomatically = (
  period: string,
  policy: RoyaltyClosePolicy,
  timeZone: string
): boolean => {
  if (policy.closeMode !== "automatic" || policy.autoCloseDay === undefined) {
    return false;
  }
  let since: Temporal.Instant;
  try {
    since = Temporal.Instant.from(policy.automaticSince);
  } catch {
    return false;
  }
  return (
    Temporal.Instant.compare(royaltyPeriodEnd(period, timeZone), since) > 0
  );
};

/** The day of the following month the batch closes `period` on, `YYYY-MM-DD`. */
export const scheduledRoyaltyCloseDate = (
  period: string,
  autoCloseDay: number
): string =>
  firstDayOf(period).add({ months: 1 }).with({ day: autoCloseDay }).toString();

/**
 * The month the console opens on: the one after the newest closed month, so
 * months are closed in order, or last month for a tenant that has closed
 * nothing yet. Never later than the current month.
 */
export const defaultOpenRoyaltyPeriod = (
  latestClosedPeriod: string | undefined,
  currentPeriod: string
): string => {
  if (latestClosedPeriod === undefined) {
    return shiftRoyaltyPeriod(currentPeriod, -1);
  }
  const next = shiftRoyaltyPeriod(latestClosedPeriod, 1);
  return next < currentPeriod ? next : currentPeriod;
};

/** What the console offers for a month that is not closed. */
export type RoyaltyCloseState =
  /** Over, and closed by a person: the console offers the close. */
  | { kind: "ready" }
  /** Still running, and closed by a person once `lastDay` has passed. */
  | { kind: "in-progress"; lastDay: string }
  /** Closed by the batch on `closeDate`; a person cannot close it. */
  | { kind: "automatic"; closeDate: string };

export const royaltyCloseState = (
  period: string,
  policy: RoyaltyClosePolicy,
  timeZone: string,
  now: Temporal.Instant = Temporal.Now.instant()
): RoyaltyCloseState => {
  if (
    policy.autoCloseDay !== undefined &&
    closesAutomatically(period, policy, timeZone)
  ) {
    return {
      closeDate: scheduledRoyaltyCloseDate(period, policy.autoCloseDay),
      kind: "automatic",
    };
  }
  if (!isRoyaltyPeriodOver(period, timeZone, now)) {
    return { kind: "in-progress", lastDay: royaltyPeriodLastDay(period) };
  }
  return { kind: "ready" };
};
