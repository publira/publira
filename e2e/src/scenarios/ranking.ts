/**
 * Records created by `db/seeds/scenarios/170_ranking.sql`.
 *
 * A ranking snapshot decides what the top page's popularity module shows for a
 * whole tenant, so the tenant that has been ranked is not one another suite
 * reads the home page of.
 */

export const RANKING_SCENARIO = "170_ranking";

export const RANKING_TENANT = {
  name: "Ranking Tenant",
  publicId: "RankTNNTAAA1",
} as const;

/**
 * The three ranked series, with the positions the seeded snapshots gave them
 * in each period and how each position moved since the period before it.
 */
export const RANKING_SERIES = {
  first: {
    dailyRank: 1,
    publicId: "RankSERSAAA1",
    title: "Ranking Series 001",
    weeklyRank: 3,
  },
  second: {
    dailyRank: 2,
    publicId: "RankSERSAAA2",
    title: "Ranking Series 002",
    weeklyRank: 1,
  },
  /** Ranked weekly only: the daily chart has never listed it. */
  third: {
    publicId: "RankSERSAAA3",
    title: "Ranking Series 003",
    weeklyRank: 2,
  },
} as const;

/**
 * The day the seeded snapshots report as computed, as the site prints it.
 *
 * `computed_at` is 2026-03-26T21:00:00Z and the tenant's zone is Asia/Tokyo,
 * so the calendar day on screen is the next one — which is what makes this
 * value evidence that the conversion happened.
 */
export const RANKING_COMPUTED_ON = "Mar 27, 2026";
