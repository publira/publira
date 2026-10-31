import { startOfDayIsoString } from "@publira/utils";

/** The most days one download covers, as the API bounds an export. */
export const MAX_EXPORT_DAYS = 366;

/**
 * The instants the list is narrowed to, from its inclusive `created_from` and
 * `created_to` days: the API takes the end exclusive, so a named last day
 * reaches the start of the day after it.
 */
export const resolveAuditLogListPeriod = (
  filters: { createdFrom: string; createdTo: string },
  timeZone: string
): { createdFrom?: string; createdTo?: string } => ({
  createdFrom: startOfDayIsoString(filters.createdFrom, timeZone) || undefined,
  createdTo: filters.createdTo
    ? startOfDayIsoString(
        Temporal.PlainDate.from(filters.createdTo).add({ days: 1 }).toString(),
        timeZone
      ) || undefined
    : undefined,
});

/**
 * The days a download covers, or why the filters shown cannot be one. Both
 * ends are inclusive calendar days of the platform's default time zone.
 */
export type AuditLogExportPeriod =
  | { ok: true; end: string; start: string }
  | { ok: false };

/**
 * The period a download of the list covers, from its `created_from` and
 * `created_to` filters.
 *
 * A missing end is today, which leaves out nothing the list shows, since no
 * entry is dated later; a missing start is the longest period the API exports
 * ending there, because the list then reaches back to the first entry and no
 * single file can.
 */
export const resolveAuditLogExportPeriod = (
  filters: { createdFrom: string; createdTo: string },
  timeZone: string,
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(timeZone)
): AuditLogExportPeriod => {
  const from = filters.createdFrom
    ? Temporal.PlainDate.from(filters.createdFrom)
    : null;

  let end = filters.createdTo
    ? Temporal.PlainDate.from(filters.createdTo)
    : today;

  if (!filters.createdTo && from && Temporal.PlainDate.compare(from, end) > 0) {
    end = from;
  }

  const start = from ?? end.subtract({ days: MAX_EXPORT_DAYS - 1 });

  if (
    Temporal.PlainDate.compare(start, end) > 0 ||
    start.until(end, { largestUnit: "days" }).days + 1 > MAX_EXPORT_DAYS
  ) {
    return { ok: false };
  }

  return { end: end.toString(), ok: true, start: start.toString() };
};
