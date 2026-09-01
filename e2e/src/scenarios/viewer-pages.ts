import { SEED_TENANT } from "./multi-tenant";

/**
 * The free seed episode's body images, added by
 * `db/seeds/scenarios/050_viewer_pages.sql` with the fixture JPEGs uploaded by
 * `e2e/scripts/seed-viewer-pages.sh`. Both run from `task e2e:db`, so the pages
 * are in place for the whole stack rather than for one suite.
 */

/** Reading-order page count; keep in sync with the scenario's generate_series. */
export const VIEWER_PAGE_COUNT = 8;

/** The episode those pages belong to. */
export const VIEWER_EPISODE_PATH = `/series/${SEED_TENANT.series.publicId}/episodes/${SEED_TENANT.series.freeEpisodeId}`;

/**
 * The accessible name the viewer gives one page's canvas, from
 * `host.episode.viewer.page_title` in the seed tenant's default locale.
 */
export const viewerPageLabel = (page: number): string =>
  `${SEED_TENANT.series.freeEpisodeTitle} ${page}ページ`;
