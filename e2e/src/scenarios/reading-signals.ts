/**
 * The development seed member's own recommendation order, which follows from
 * the reading `db/seeds/dev/090_reading_signals.sql` writes for them: six
 * views of `Seed Series 030` and three of `Seed Series 014`, with the features
 * the batch builds from them.
 *
 * `task e2e:db` seeds the development data, so this order is part of the state
 * every suite starts from. Series are named by their `public_id`, which is what
 * a card's link carries.
 */

/** `Seed Series NNN`'s `public_id`, derived the way the seed derives it. */
export const seedSeriesPublicId = (seriesNumber: number): string =>
  `SeedSERS${seriesNumber.toString().padStart(4, "0").replaceAll("0", "A")}`;

/**
 * The first row of the member's shelf, in order, all of it all-ages.
 *
 * `Seed Series 090` shares the most with what the member read and `Seed Series
 * 050` the next most. 070, 054, and 010 then tie, and so do 074 and 060; the
 * publication date settles a tie, and `160_screenshot_baseline.sql` dates a
 * higher-numbered series later, so the higher number comes first.
 */
export const READER_RECOMMENDED_SERIES_IDS = [90, 50, 70, 54, 10, 74].map(
  seedSeriesPublicId
);
