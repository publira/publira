/**
 * Records `db/seeds/scenarios/740_episode_preview.sql` changes on the
 * development seed tenant: one of its episodes priced, with its first pages
 * open as a preview.
 */

export const EPISODE_PREVIEW_SCENARIO = "740_episode_preview";

export const EPISODE_PREVIEW_SERIES = {
  publicId: "SeedSERSAA2A",
  title: "Seed Series 020",
} as const;

/** 300 yen, with eight pages of which the first three are the preview. */
export const EPISODE_PREVIEW_EPISODE = {
  previewPageCount: 3,
  publicId: "SeedEPSDA191",
  title: "Seed Episode 020-01",
} as const;

export const EPISODE_PREVIEW_PATH = `/series/${EPISODE_PREVIEW_SERIES.publicId}/episodes/${EPISODE_PREVIEW_EPISODE.publicId}`;
