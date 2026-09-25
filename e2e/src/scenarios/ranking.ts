/**
 * The rankings `db/seeds/scenarios/170_ranking.sql` writes for the development
 * seed tenant: tenant-wide, and for each genre.
 *
 * `task e2e:db` applies that file, so these positions are part of the state
 * every suite starts from — the screenshot projects included.
 */

/**
 * Series named by the title the development seed gives them, with the place
 * each holds in the seeded snapshots and what its marker therefore says.
 */
export const RANKING_SERIES = {
  /** Climbed one place in the week, and lost two on the day. */
  climbed: {
    title: "Seed Series 042",
    weeklyMovement: "Up 1",
    weeklyRank: 1,
  },
  /** New to the daily chart: the day before listed another work in its place. */
  entered: {
    dailyMovement: "New",
    dailyRank: 3,
    title: "Seed Series 099",
  },
  /** Led the week before and gave up two places. */
  fell: {
    title: "Seed Series 007",
    weeklyMovement: "Down 2",
    weeklyRank: 3,
  },
  /** Held the top of the daily chart, and had never been ranked weekly. */
  held: {
    dailyMovement: "No change",
    dailyRank: 1,
    title: "Seed Series 100",
    weeklyMovement: "New",
    weeklyRank: 2,
  },
} as const;

/** Positions in each of the seeded snapshots. */
export const RANKING_ENTRY_COUNT = 10;

/**
 * The day the seeded snapshots report as computed, as the site prints it:
 * `computed_at` is 2026-04-20T06:00:00Z.
 */
export const RANKING_COMPUTED_ON = "Apr 20, 2026";

/**
 * The genre whose weekly leaderboard ranks fewer series than a tile has
 * covers: its tile draws the two ranked series in rank order, then the genre's
 * two newest. Numbers are those of `Seed Series NNN`.
 */
export const RANKED_GENRE = {
  coverSeriesNumbers: [42, 30, 90, 84],
  name: "Action",
} as const;

/**
 * The `series_images` id `db/seeds/dev/060_images.sql` gives `Seed Series NNN`,
 * derived the way its SQL derives it. A cover's URL is
 * `/images/series/{id}/…`, so this is what says which series a cover is.
 */
export const seedSeriesImageId = (seriesNumber: number): string => {
  const sequence = seriesNumber.toString(16);
  return `018f0e76-${sequence.padStart(4, "0")}-7000-8000-${sequence.padStart(12, "0")}`;
};
