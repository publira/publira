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

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getDateTimeFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
};

/**
 * Parse an absolute timestamp to `Temporal.Instant`.
 * Only RFC3339 / ISO-8601 forms accepted by `Temporal.Instant.from`
 * (must include `Z` or a numeric offset). Zone-less strings are rejected so
 * results never depend on the host local time zone.
 */
const tryParseInstant = (value: string): Temporal.Instant | null => {
  if (!value) {
    return null;
  }

  try {
    return Temporal.Instant.from(value);
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

  const instant = tryParseInstant(value);
  if (!instant) {
    return fallback;
  }

  return getDateTimeFormatter(timeZone).format(instant.epochMilliseconds);
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

  const instant = tryParseInstant(value);
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
