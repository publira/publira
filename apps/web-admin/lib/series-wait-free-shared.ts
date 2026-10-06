/** The year the API bounds both periods of the rule to, in hours. */
export const MAX_WAIT_FREE_HOURS = 8760;

/** The largest count an `int32` field carries. */
export const MAX_WAIT_FREE_EXCLUDED_LATEST_COUNT = 2_147_483_647;

/**
 * One series' wait-for-free rule: a signed-in reader may open one priced
 * episode of the series for `accessHours`, once every `rechargeHours`.
 */
export interface SeriesWaitFreeSettings {
  enabled: boolean;
  rechargeHours: number;
  accessHours: number;
  /** How many of the newest published episodes a ticket cannot open. */
  excludedLatestCount: number;
}
