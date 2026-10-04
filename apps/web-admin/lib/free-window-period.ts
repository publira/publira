import type { Locale } from "@publira/i18n";
import { parseInstant, toInstantIsoString } from "@publira/utils";

import { getMessagesFor } from "./messages";

export type FreeWindowPeriodResult =
  | { ok: true; startsAt: string; endsAt: string }
  | { ok: false; message: string };

/**
 * The period a schedule form posted, as the two instants the API takes.
 *
 * Each field carries the instant the form resolved in the zone it was rendered
 * in; a leftover wall clock (no JS) is read in `timeZone`. The checks are the
 * server's own — an end after the start and still ahead — made here as well
 * so the editor is answered next to the form rather than by a refused RPC. A
 * start already passed is allowed: that is how an episode is made free now.
 */
export const toFreeWindowPeriod = async (
  input: { startsAt: string; endsAt: string },
  timeZone: string,
  locale: Locale,
  now: Temporal.Instant = Temporal.Now.instant()
): Promise<FreeWindowPeriodResult> => {
  const t = await getMessagesFor(locale);
  const startsAt = toInstantIsoString(input.startsAt, timeZone);
  const start = parseInstant(startsAt);
  if (!start) {
    return {
      message: t(
        "admin.series.episodes.free_windows.validation.starts_at_invalid"
      ),
      ok: false,
    };
  }
  const endsAt = toInstantIsoString(input.endsAt, timeZone);
  const end = parseInstant(endsAt);
  if (!end) {
    return {
      message: t(
        "admin.series.episodes.free_windows.validation.ends_at_invalid"
      ),
      ok: false,
    };
  }
  if (
    Temporal.Instant.compare(end, start) <= 0 ||
    Temporal.Instant.compare(end, now) <= 0
  ) {
    return {
      message: t(
        "admin.series.episodes.free_windows.validation.period_invalid"
      ),
      ok: false,
    };
  }

  return { endsAt, ok: true, startsAt };
};

/** Where a window stands against the present moment. */
export type EpisodeFreeWindowStatus = "ended" | "open" | "scheduled";

/**
 * The window's standing at `now`. The window is half-open, so it has ended at
 * the very instant it ends, which is when the next one may begin.
 */
export const episodeFreeWindowStatus = (
  window: { startsAt: string; endsAt: string },
  now: Temporal.Instant
): EpisodeFreeWindowStatus => {
  const start = parseInstant(window.startsAt);
  const end = parseInstant(window.endsAt);
  if (end && Temporal.Instant.compare(end, now) <= 0) {
    return "ended";
  }
  if (start && Temporal.Instant.compare(start, now) > 0) {
    return "scheduled";
  }
  return "open";
};
