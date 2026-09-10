/**
 * The classification a series carries beside its title: how it is serialized,
 * which weekdays a new episode is expected on, and who it is meant for.
 *
 * The values are written as strings rather than as the generated proto enums
 * because that is what a form posts and what a `<select>` holds. `series.ts`
 * is where they meet the enums, and it is in the server graph — this module is
 * the half a Client Component may import.
 */

/** Serialization state, as `SeriesStatus` names it. */
export const SERIES_STATUS_VALUES = ["ongoing", "completed", "hiatus"] as const;

export type SeriesStatusValue = (typeof SERIES_STATUS_VALUES)[number];

/**
 * What a series is stored with when nobody chose. It is the column default the
 * API documents for an unspecified status, stated here so the form opens on the
 * same value a save without the field would have written.
 */
export const DEFAULT_SERIES_STATUS: SeriesStatusValue = "ongoing";

/** Who the series is meant for, as `SeriesAgeRating` names it. */
export const SERIES_AGE_RATING_VALUES = ["all", "r15", "r18"] as const;

export type SeriesAgeRatingValue = (typeof SERIES_AGE_RATING_VALUES)[number];

/** The column default, for the reason {@link DEFAULT_SERIES_STATUS} is. */
export const DEFAULT_SERIES_AGE_RATING: SeriesAgeRatingValue = "all";

/**
 * How many tags one series carries, the bound the API enforces. A series
 * wearing more labels than a reader can take in groups it with everything and
 * therefore with nothing.
 */
export const MAX_SERIES_TAGS = 20;
