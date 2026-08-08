/**
 * Tenant-timezone-aware date/time helpers.
 *
 * Requires `Temporal` at runtime (`temporal-polyfill/global` installed by apps
 * and by this package's vitest setup; see https://github.com/publira/publira/issues/573).
 *
 * Absolute timestamps are RFC3339 / ISO-8601 instants with an explicit offset or
 * `Z` (parsed only via `Temporal.Instant.from` — no host-local `Date` parsing).
 * Wall-clock strings use the HTML `datetime-local` shape
 * (`YYYY-MM-DDTHH:mm`, optionally with seconds / fractional seconds).
 */

/** Default IANA zone when `timeZone` is omitted (gradual migration from fixed JST). */
export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export interface FormatDateTimeOptions {
  fallback?: string;
  /**
   * IANA time zone used for display (e.g. `Asia/Tokyo`, `America/Los_Angeles`).
   * Defaults to {@link DEFAULT_TIME_ZONE}.
   */
  timeZone?: string;
}

export interface ToDateTimeLocalOptions {
  /** Returned when `value` is empty or not a valid absolute timestamp. Default: `""`. */
  fallback?: string;
}

/**
 * HTML `datetime-local` wall clock: date + `T` + time, no offset / `Z` / zone id.
 * @see https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#local-date-and-time-strings
 */
const DATETIME_LOCAL_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/u;

/** Calendar day with no time and no zone (`YYYY-MM-DD`), as emitted by `<input type="date">`. */
const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getCachedFormatter = (
  cache: Map<string, Intl.DateTimeFormat>,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat => {
  const cached = cache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("ja-JP", { ...options, timeZone });
  cache.set(timeZone, formatter);
  return formatter;
};

const getDateTimeFormatter = (timeZone: string): Intl.DateTimeFormat =>
  getCachedFormatter(dateTimeFormatterCache, timeZone, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const getDateFormatter = (timeZone: string): Intl.DateTimeFormat =>
  getCachedFormatter(dateFormatterCache, timeZone, { dateStyle: "medium" });

/**
 * Parse an absolute timestamp to `Temporal.Instant`.
 * Only RFC3339 / ISO-8601 forms accepted by `Temporal.Instant.from`
 * (must include `Z` or a numeric offset). Zone-less strings are rejected so
 * results never depend on the host local time zone.
 *
 * Use this instead of `new Date(value)` whenever an API timestamp has to be
 * compared, sorted, or validated.
 */
export const parseInstant = (value: string): Temporal.Instant | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return Temporal.Instant.from(trimmed);
  } catch {
    return null;
  }
};

const padTwo = (n: number): string => String(n).padStart(2, "0");

/**
 * Format an absolute timestamp for display in the given (or default) time zone.
 * Invalid / empty input returns `options.fallback` (default: the original `value`).
 */
export const formatDateTime = (
  value: string,
  options?: FormatDateTimeOptions
): string => {
  const fallback = options?.fallback ?? value;
  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE;

  const instant = parseInstant(value);
  if (!instant) {
    return fallback;
  }

  return getDateTimeFormatter(timeZone).format(instant.epochMilliseconds);
};

/**
 * Same as {@link formatDateTime} but date-only, for timestamps whose time part
 * should not be shown. The calendar day is the one seen in `timeZone`, not the
 * UTC day — never derive it by slicing the ISO string.
 */
export const formatDate = (
  value: string,
  options?: FormatDateTimeOptions
): string => {
  const fallback = options?.fallback ?? value;
  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE;

  const instant = parseInstant(value);
  if (!instant) {
    return fallback;
  }

  return getDateFormatter(timeZone).format(instant.epochMilliseconds);
};

/**
 * Absolute instant → `datetime-local` wall clock (`YYYY-MM-DDTHH:mm`) in `timeZone`.
 * Does not use the host environment's local time zone.
 */
export const toDateTimeLocalValue = (
  value: string,
  timeZone: string,
  options?: ToDateTimeLocalOptions
): string => {
  const fallback = options?.fallback ?? "";

  const instant = parseInstant(value);
  if (!instant) {
    return fallback;
  }

  const zoned = instant.toZonedDateTimeISO(timeZone);
  return `${zoned.year}-${padTwo(zoned.month)}-${padTwo(zoned.day)}T${padTwo(zoned.hour)}:${padTwo(zoned.minute)}`;
};

/**
 * `datetime-local` wall clock + IANA zone → absolute ISO-8601 instant (`…Z`).
 * Empty, non-`datetime-local`, or unparseable input returns `""`.
 * Values with `Z`, numeric offsets, or time-zone annotations are rejected so
 * `PlainDateTime.from` cannot silently ignore zone metadata.
 *
 * Ambiguous / non-existent local times (DST) use Temporal's `compatible`
 * disambiguation (same default as `PlainDateTime.toZonedDateTime`).
 */
export const fromDateTimeLocalValue = (
  value: string,
  timeZone: string
): string => {
  const trimmed = value.trim();
  if (!trimmed || !DATETIME_LOCAL_RE.test(trimmed)) {
    return "";
  }

  try {
    const plain = Temporal.PlainDateTime.from(trimmed);
    const zoned = plain.toZonedDateTime(timeZone, {
      disambiguation: "compatible",
    });
    return zoned.toInstant().toString();
  } catch {
    return "";
  }
};

/**
 * Normalize a form / query value that may be **either** an absolute timestamp
 * (`Z` or numeric offset — passed through) **or** a `datetime-local` wall clock
 * (interpreted in `timeZone`) into an absolute ISO-8601 instant (`…Z`).
 *
 * This is the replacement for `new Date(value).toISOString()` in server
 * actions: `Date` would silently read a zone-less value in the *server's* local
 * zone, so the same submission meant something different per deployment.
 * Returns `""` when the value is empty or in neither shape.
 */
export const toInstantIsoString = (value: string, timeZone: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return (
    parseInstant(trimmed)?.toString() ??
    fromDateTimeLocalValue(trimmed, timeZone)
  );
};

const plainDateOrNull = (value: string): Temporal.PlainDate | null => {
  const trimmed = value.trim();
  if (!PLAIN_DATE_RE.test(trimmed)) {
    return null;
  }

  try {
    return Temporal.PlainDate.from(trimmed);
  } catch {
    return null;
  }
};

/**
 * Date-only filter value (`YYYY-MM-DD`) → the first instant of that calendar
 * day **in `timeZone`**, as an ISO-8601 instant.
 *
 * The zone is what makes the boundary meaningful: `` `${date}T00:00:00Z` ``
 * pins the day to UTC, which is nine hours off from the day the operator
 * actually picked in a JST-facing UI. Returns `""` for empty / non-date input.
 */
export const startOfDayIsoString = (date: string, timeZone: string): string => {
  const plainDate = plainDateOrNull(date);
  if (!plainDate) {
    return "";
  }

  try {
    return plainDate.toZonedDateTime(timeZone).toInstant().toString();
  } catch {
    return "";
  }
};

/**
 * Date-only filter value (`YYYY-MM-DD`) → the **inclusive** last instant of that
 * calendar day in `timeZone`, as an ISO-8601 instant.
 *
 * Derived as "start of the next day minus one nanosecond" so DST transitions
 * (a day that is 23 or 25 hours long) stay correct. Nanoseconds rather than the
 * microsecond precision of a Postgres `timestamptz`: this helper should not
 * assume the consumer's storage precision, and a value that is too precise is
 * truncated back into the same day, whereas a value that is too coarse silently
 * drops rows.
 * Returns `""` for empty / non-date input.
 */
export const endOfDayIsoString = (date: string, timeZone: string): string => {
  const plainDate = plainDateOrNull(date);
  if (!plainDate) {
    return "";
  }

  try {
    return plainDate
      .add({ days: 1 })
      .toZonedDateTime(timeZone)
      .toInstant()
      .subtract({ nanoseconds: 1 })
      .toString();
  } catch {
    return "";
  }
};
