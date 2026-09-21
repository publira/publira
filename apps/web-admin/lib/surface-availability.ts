/**
 * Which surfaces a work may be shown on: both, the web storefront alone, or
 * the mobile app alone.
 *
 * Strings rather than the generated `SurfaceAvailability` enum, because that is
 * what a form posts. `surface-availability-enum.ts` is where they meet the
 * enum, and it is in the server graph — this module is the half a Client
 * Component may import.
 */
export const SURFACE_AVAILABILITIES = ["all", "web", "app"] as const;

export type SurfaceAvailabilityValue = (typeof SURFACE_AVAILABILITIES)[number];

/** What a series nobody has set is shown on, as the API stores it. */
export const DEFAULT_SURFACE_AVAILABILITY: SurfaceAvailabilityValue = "all";

export const isSurfaceAvailabilityValue = (
  value: string
): value is SurfaceAvailabilityValue =>
  SURFACE_AVAILABILITIES.some((availability) => availability === value);

/**
 * What one episode states of its own. The empty value is the episode following
 * its series, stored as no value at all, which is what keeps it following after
 * the series changes.
 */
export type EpisodeAvailabilityOverride = "" | SurfaceAvailabilityValue;

export const EPISODE_AVAILABILITY_OVERRIDES = [
  "",
  ...SURFACE_AVAILABILITIES,
] as const satisfies readonly EpisodeAvailabilityOverride[];

export const isEpisodeAvailabilityOverride = (
  value: string
): value is EpisodeAvailabilityOverride =>
  EPISODE_AVAILABILITY_OVERRIDES.some((override) => override === value);

/**
 * Where an episode is actually shown. The series is the upper bound, so an
 * episode naming the one surface its series is kept off is shown nowhere.
 */
export const episodeShownOn = (
  seriesAvailability: SurfaceAvailabilityValue,
  override: EpisodeAvailabilityOverride
): SurfaceAvailabilityValue | "none" => {
  if (override === "" || override === "all") {
    return seriesAvailability;
  }
  if (seriesAvailability === "all" || seriesAvailability === override) {
    return override;
  }
  return "none";
};
