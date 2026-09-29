/**
 * IANA time zone helpers for the tenant time zone setting.
 *
 * The authority for what a tenant may store is the Go server
 * (`server/internal/tenanttz`), which validates against the embedded IANA
 * tzdata. These helpers exist so a form can offer the runtime's zone list and
 * reject an obviously wrong value before the round trip — they never widen what
 * the server accepts, and a value that passes here can still be refused there.
 *
 * Requires `Temporal` at runtime, like the rest of this package's date/time
 * helpers (see `format-date-time.ts`).
 */

/**
 * `Area/Location` shape, plus single-segment names such as `UTC`.
 *
 * Offset zones (`+09:00`) are deliberately not matched: `Temporal` accepts them
 * as a time zone, but Go's `time.LoadLocation` does not, so storing one would
 * fail on the server.
 */
const IANA_TIME_ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/u;

/**
 * Offered when the runtime cannot enumerate its tzdata. `Intl.supportedValuesOf`
 * is typed as always present, but a runtime without it would leave the picker
 * empty and the setting unchangeable, so a small set of common zones stands in.
 */
const FALLBACK_TIME_ZONES: readonly string[] = [
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "UTC",
];

let cachedTimeZones: readonly string[] | undefined;

/**
 * IANA zone names offered by the runtime, sorted by name. Which aliases appear
 * depends on the runtime's ICU build, so treat it as the picker's option list
 * rather than as the definition of a valid value — that is
 * {@link isValidTimeZone}.
 *
 * The result is memoized: the list is fixed for the life of the process (it
 * changes only with the runtime's tzdata), and building it per render for a
 * picker with a few hundred entries is pure waste.
 */
export const listSupportedTimeZones = (): readonly string[] => {
  if (cachedTimeZones) {
    return cachedTimeZones;
  }

  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [...FALLBACK_TIME_ZONES];

  // `UTC` is a legitimate tenant choice but is not enumerated by every ICU
  // build, so it is merged in rather than left to the runtime.
  const zones = [...new Set([...supported, "UTC"])].toSorted((left, right) =>
    left.localeCompare(right, "en")
  );

  cachedTimeZones = zones;
  return zones;
};

/**
 * Whether `value` is a usable IANA time zone name for the tenant setting.
 *
 * Aliases the runtime resolves but does not enumerate (`Asia/Calcutta`) are
 * accepted, matching `time.LoadLocation` on the server. `Local` is rejected: Go
 * resolves it to the API process's own zone, which is not a portable setting.
 */
export const isValidTimeZone = (value: string): boolean => {
  const trimmed = value.trim();
  if (!IANA_TIME_ZONE_RE.test(trimmed) || trimmed.toLowerCase() === "local") {
    return false;
  }

  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(trimmed);
    return true;
  } catch {
    return false;
  }
};
