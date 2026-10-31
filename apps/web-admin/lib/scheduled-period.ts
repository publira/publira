import type { Locale } from "@publira/i18n";
import { parseInstant, toInstantIsoString } from "@publira/utils";

import { getMessagesFor } from "./messages";

export type ScheduledPeriodResult =
  | { ok: true; startsAt: string; endsAt: string }
  | { ok: false; message: string };

/**
 * The period a schedule form posted, as the two instants the API takes.
 *
 * Each field carries the instant the form resolved in the zone it was rendered
 * in; a leftover wall clock (no JS) is read in `timeZone`. The checks are the
 * server's own — an end after the start and still ahead — made here as well
 * so the editor is answered next to the form rather than by a refused RPC. A
 * start already passed is allowed: that is how a period is made to start now.
 */
export const toScheduledPeriod = async (
  input: { startsAt: string; endsAt: string },
  timeZone: string,
  locale: Locale,
  now: Temporal.Instant = Temporal.Now.instant()
): Promise<ScheduledPeriodResult> => {
  const t = await getMessagesFor(locale);
  const startsAt = toInstantIsoString(input.startsAt, timeZone);
  const start = parseInstant(startsAt);

  if (!start) {
    return {
      message: t("admin.series.episodes.period.starts_at_invalid"),
      ok: false,
    };
  }

  const endsAt = toInstantIsoString(input.endsAt, timeZone);
  const end = parseInstant(endsAt);

  if (!end) {
    return {
      message: t("admin.series.episodes.period.ends_at_invalid"),
      ok: false,
    };
  }

  if (
    Temporal.Instant.compare(end, start) <= 0 ||
    Temporal.Instant.compare(end, now) <= 0
  ) {
    return {
      message: t("admin.series.episodes.period.invalid"),
      ok: false,
    };
  }

  return { endsAt, ok: true, startsAt };
};

/** Where a scheduled period stands against the present moment. */
export type ScheduledPeriodStatus = "ended" | "open" | "scheduled";

/**
 * The period's standing at `now`: a free reading period's, or a campaign
 * price's. The period is half-open, so it has ended at the very instant it
 * ends, which is when the next one may begin.
 */
export const scheduledPeriodStatus = (
  period: { startsAt: string; endsAt: string },
  now: Temporal.Instant
): ScheduledPeriodStatus => {
  const start = parseInstant(period.startsAt);
  const end = parseInstant(period.endsAt);

  if (end && Temporal.Instant.compare(end, now) <= 0) {
    return "ended";
  }

  if (start && Temporal.Instant.compare(start, now) > 0) {
    return "scheduled";
  }

  return "open";
};
