/**
 * Tenant-timezone-aware date/time helpers.
 *
 * Requires `Temporal` at runtime (`temporal-polyfill/global` installed by apps
 * and by this package's vitest setup; see https://github.com/publira/publira/issues/573).
 *
 * Absolute timestamps are RFC3339 / ISO-8601 instants. Wall-clock strings use the
 * HTML `datetime-local` shape (`YYYY-MM-DDTHH:mm`, optionally with seconds).
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
 * Parse an absolute timestamp string to `Temporal.Instant`.
 * Accepts RFC3339 / ISO-8601; falls back to `Date.parse` for lenient legacy values.
 */
const tryParseInstant = (value: string): Temporal.Instant | null => {
  if (!value) {
    return null;
  }

  try {
    return Temporal.Instant.from(value);
  } catch {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      return null;
    }
    return Temporal.Instant.fromEpochMilliseconds(ms);
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
 * Empty or unparseable input returns `""`.
 *
 * Ambiguous / non-existent local times (DST) use Temporal's `compatible`
 * disambiguation (same default as `PlainDateTime.toZonedDateTime`).
 */
export const fromDateTimeLocalValue = (
  value: string,
  timeZone: string
): string => {
  const trimmed = value.trim();
  if (!trimmed) {
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
