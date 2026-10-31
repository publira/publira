/** The most days one download covers, as the API bounds an export. */
export const MAX_EXPORT_DAYS = 366;

/**
 * The days a download covers, or why the filters shown cannot be one. Both
 * ends are inclusive calendar days of the tenant.
 */
export type AuditLogExportPeriod =
  | { ok: true; end: string; start: string }
  | { ok: false };

/**
 * The period a download of the list covers, from its `from` and `to` filters.
 *
 * A missing end is today, which leaves out nothing the list shows, since no
 * entry is dated later; a missing start is the longest period the API exports
 * ending there, because the list then reaches back to the first entry and no
 * single file can.
 */
export const resolveAuditLogExportPeriod = (
  filters: { from: string; to: string },
  timeZone: string,
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(timeZone)
): AuditLogExportPeriod => {
  const from = filters.from ? Temporal.PlainDate.from(filters.from) : null;
  let end = filters.to ? Temporal.PlainDate.from(filters.to) : today;

  if (!filters.to && from && Temporal.PlainDate.compare(from, end) > 0) {
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
