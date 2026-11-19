/**
 * Records `db/seeds/scenarios/850_next_free_episode.sql` changes on the
 * development seed tenant: two episodes of one series priced, so a free
 * episode is followed by a paid one and a free one comes after that.
 */

export const NEXT_FREE_EPISODE_SCENARIO = "850_next_free_episode";

export const NEXT_FREE_EPISODE_SERIES = {
  publicId: "SeedSERSAA12",
  title: "Seed Series 012",
} as const;

const episodePath = (publicId: string): string =>
  `/series/${NEXT_FREE_EPISODE_SERIES.publicId}/episodes/${publicId}`;

/** The free episode the reader finishes. */
export const FINISHED_FREE_EPISODE = {
  path: episodePath("SeedEPSDA112"),
  title: "Seed Episode 012-02",
} as const;

/** The episode after it, priced at 300 yen like the one after that. */
export const PAID_NEXT_EPISODE = {
  path: episodePath("SeedEPSDA113"),
  priceLabel: "¥300",
  title: "Seed Episode 012-03",
} as const;

/** The first free episode past the paid ones. */
export const LATER_FREE_EPISODE = {
  number: 5,
  path: episodePath("SeedEPSDA115"),
  title: "Seed Episode 012-05",
} as const;
