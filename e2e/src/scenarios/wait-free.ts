/**
 * Records created by `db/seeds/scenarios/410_wait_free.sql`.
 *
 * A series whose wait-for-free rule is on, on a tenant of its own: the member
 * spends the series' ticket, and no other suite should meet that half-way.
 */

export const WAIT_FREE_SCENARIO = "410_wait_free";

export const WAIT_FREE_SERIES = {
  publicId: "WtfrSERSAAA1",
  title: "Wait Free Series 001",
} as const;

/** The series' three priced episodes, in reading order. */
export const WAIT_FREE_EPISODES = {
  /** The one the suite opens with the ticket; it carries three pages. */
  first: { publicId: "WtfrEPSDAAA1", title: "Wait Free Episode 001-01" },
  /** The latest, which the rule keeps a ticket off. */
  latest: { publicId: "WtfrEPSDAAA3", title: "Wait Free Episode 001-03" },
  /** Still locked once the ticket is spent, so it shows the countdown. */
  second: { publicId: "WtfrEPSDAAA2", title: "Wait Free Episode 001-02" },
} as const;

/** The reader who spends the ticket. Password hash is `memberpass`. */
export const WAIT_FREE_MEMBER = {
  email: "wait-free-member@example.com",
  password: "memberpass",
  publicId: "WtfrMMBRAAA1",
} as const;

/** Path of one of the series' episodes. */
export const waitFreeEpisodePath = (episodePublicId: string): string =>
  `/series/${WAIT_FREE_SERIES.publicId}/episodes/${episodePublicId}`;
