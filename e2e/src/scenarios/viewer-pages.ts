import { SEED_TENANT } from "./multi-tenant";

/**
 * The episode the reading and viewer suites open. Every seeded episode has a
 * body — `db/seeds/dev/060_images.sql` gives each one eight pages and
 * `task storage:seed` uploads them — so this is `Seed Episode 001-02` only
 * because the suites that assert on the first episode of the series are about
 * something else.
 */
export const VIEWER_EPISODE_ID = "SeedEPSDAAA2";
export const VIEWER_EPISODE_TITLE = "Seed Episode 001-02";

/** Reading-order page count; keep in sync with the seed's generate_series. */
export const VIEWER_PAGE_COUNT = 8;

/**
 * Where `VIEWER_EPISODE_ID` sits in the seeded catalogue, counting every
 * episode of every seed series in the order the seed numbers them. The page
 * ids below are derived from it the way the seed derives them.
 */
const VIEWER_EPISODE_NO = 2;

/** The episode those pages belong to. */
export const VIEWER_EPISODE_PATH = `/series/${SEED_TENANT.series.publicId}/episodes/${VIEWER_EPISODE_ID}`;

/**
 * The published episode after it, which is what the end of the episode offers.
 * Free, like every seeded episode but `Seed Episode 001-10`.
 */
export const NEXT_EPISODE_ID = "SeedEPSDAAA3";
export const NEXT_EPISODE_TITLE = "Seed Episode 001-03";
export const NEXT_EPISODE_PATH = `/series/${SEED_TENANT.series.publicId}/episodes/${NEXT_EPISODE_ID}`;

/**
 * The episode before the priced one, so what it offers next is an episode a
 * reader has to buy: the price has to be on screen before the tap, and the
 * tap has to land on the access gate.
 */
export const PENULTIMATE_EPISODE_PATH = `/series/${SEED_TENANT.series.publicId}/episodes/SeedEPSDAAA9`;

/** The last published episode of the series, which nothing follows. */
export const LAST_EPISODE_PATH = `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.paidEpisodeId}`;

/**
 * The last published episode of a series whose last episode is free, so its
 * pages open to a signed-out reader and the page after them can be reached:
 * `Seed Episode 002-10`, seq_no 20 in `db/seeds/dev/010_catalog.sql`.
 */
export const FREE_LAST_EPISODE_SERIES_TITLE = "Seed Series 002";
export const FREE_LAST_EPISODE_TITLE = "Seed Episode 002-10";
export const FREE_LAST_EPISODE_PATH =
  "/series/SeedSERSAAA2/episodes/SeedEPSDAA2A";

/** What `Seed Episode 001-10` costs, as the seed prices it. */
export const LAST_EPISODE_PRICE_LABEL = "¥500";

/**
 * The accessible name the viewer gives one page's canvas, from
 * `host.episode.viewer.page_title` in the seed tenant's default locale.
 */
export const episodePageLabel = (episodeTitle: string, page: number): string =>
  `${episodeTitle}, page ${page}`;

/** The same, for the episode the viewer suites open. */
export const viewerPageLabel = (page: number): string =>
  episodePageLabel(VIEWER_EPISODE_TITLE, page);

/**
 * The accessible name of the reader's `<progress>`, from
 * `host.episode.viewer.progress`. Its `value` is the last page of the spread on
 * screen and its `max` is the page count, so the reader's own report of where
 * it is can be read without depending on the wording of the status text.
 */
export const VIEWER_PROGRESS_LABEL = "Reading progress";

/**
 * The `episode_images` id the development seed gives one page, derived the way
 * its SQL derives it. A page's body request is `/images/episodes/{id}`, so this
 * is what a suite intercepts to fail a single page and leave the rest of the
 * episode alone.
 */
export const viewerPageImageId = (page: number): string => {
  const sequence = (
    (VIEWER_EPISODE_NO - 1) * VIEWER_PAGE_COUNT +
    page
  ).toString(16);
  return `018f0e7c-${sequence.padStart(4, "0")}-7000-8000-${sequence.padStart(12, "0")}`;
};
