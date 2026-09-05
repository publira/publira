import { SEED_TENANT } from "./multi-tenant";

/**
 * The episode `db/seeds/scenarios/050_viewer_pages.sql` gives a body to, with
 * the fixture JPEGs uploaded by `e2e/scripts/seed-viewer-pages.sh`. Both run
 * from `task e2e:db`, so the pages are in place for the whole stack rather than
 * for one suite.
 *
 * `Seed Episode 001-02` rather than the series' first episode: 001-01 is the
 * one other suites reach for, and mobile's live integration test reads its
 * empty state as proof of a working round trip.
 */
export const VIEWER_EPISODE_ID = "SeedEPSDAAA2";
export const VIEWER_EPISODE_TITLE = "Seed Episode 001-02";

/** Reading-order page count; keep in sync with the scenario's generate_series. */
export const VIEWER_PAGE_COUNT = 8;

/** The episode those pages belong to. */
export const VIEWER_EPISODE_PATH = `/series/${SEED_TENANT.series.publicId}/episodes/${VIEWER_EPISODE_ID}`;

/**
 * The accessible name the viewer gives one page's canvas, from
 * `host.episode.viewer.page_title` in the seed tenant's default locale.
 */
export const viewerPageLabel = (page: number): string =>
  `${VIEWER_EPISODE_TITLE}, page ${page}`;

/**
 * The accessible name of the reader's `<progress>`, from
 * `host.episode.viewer.progress`. Its `value` is the last page of the spread on
 * screen and its `max` is the page count, so the reader's own report of where
 * it is can be read without depending on the wording of the status text.
 */
export const VIEWER_PROGRESS_LABEL = "Reading progress";

/**
 * The `episode_images` id the scenario gives one page, derived the way its SQL
 * derives it. A page's body request is `/images/episodes/{id}`, so this is what
 * a suite intercepts to fail a single page and leave the rest of the episode
 * alone.
 */
export const viewerPageImageId = (page: number): string =>
  `0199a121-1121-7000-8000-${String(page).padStart(12, "0")}`;
