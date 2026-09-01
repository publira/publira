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
const VIEWER_EPISODE_ID = "SeedEPSDAAA2";
const VIEWER_EPISODE_TITLE = "Seed Episode 001-02";

/** Reading-order page count; keep in sync with the scenario's generate_series. */
export const VIEWER_PAGE_COUNT = 8;

/** The episode those pages belong to. */
export const VIEWER_EPISODE_PATH = `/series/${SEED_TENANT.series.publicId}/episodes/${VIEWER_EPISODE_ID}`;

/**
 * The accessible name the viewer gives one page's canvas, from
 * `host.episode.viewer.page_title` in the seed tenant's default locale.
 */
export const viewerPageLabel = (page: number): string =>
  `${VIEWER_EPISODE_TITLE} ${page}ページ`;
