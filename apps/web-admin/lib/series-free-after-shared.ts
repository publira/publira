/** The ten years the API bounds the rule's wait to, in days. */
export const MAX_FREE_AFTER_DAYS = 3650;

/** The largest count an `int32` field carries. */
export const MAX_FREE_AFTER_EXCLUDED_LATEST_COUNT = 2_147_483_647;

/**
 * One series' free-after-publication rule: each published, priced episode
 * becomes free to everyone `daysAfterPublication` days after it was published.
 */
export interface SeriesFreeAfterSettings {
  enabled: boolean;
  daysAfterPublication: number;
  /** How many of the newest published episodes stay priced. */
  excludedLatestCount: number;
}
