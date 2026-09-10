/**
 * The ranking `db/seeds/scenarios/170_ranking.sql` writes for the development
 * seed tenant.
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
 * The day the seeded snapshots report as computed, as the site prints it.
 *
 * `computed_at` is 2026-04-19T21:00:00Z and the tenant's zone is Asia/Tokyo,
 * so the calendar day on screen is the next one — which is what makes this
 * value evidence that the conversion happened.
 */
export const RANKING_COMPUTED_ON = "Apr 20, 2026";
