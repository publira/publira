import type { Locale } from "@publira/i18n";
import { parseInstant, WEEKDAY_NUMBERS } from "@publira/utils";
import { cachedReadFailure } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";

import { listPublishedAuthors } from "./authors";
import {
  getSeriesDetail,
  listPublishedLabels,
  listPublishedSeries,
  listRankedSeries,
  listRecommendedSeries,
} from "./catalog";
import type {
  EyeCatchImageVariant,
  LabelListItem,
  RankedSeriesItem,
  SeriesListItem,
} from "./catalog";

export interface CatalogTopEpisodeItem {
  episodeId: string;
  episodeOrderIndex: number;
  episodeTitle: string;
  /**
   * The series eye-catch. An episode carries no image of its own, and the row
   * that shows it stands next to episodes of other series, so this is what
   * tells one row from the next.
   */
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  publishedAt: string;
  seriesId: string;
  seriesTitle: string;
}

export interface CatalogTopUpdatedSeriesItem {
  creatorNames: string[];
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  latestEpisodeId: string;
  latestEpisodeOrderIndex: number;
  latestEpisodeTitle: string;
  latestPublishedAt: string;
  seriesId: string;
  seriesTitle: string;
}

/** The work the top page opens with, and the episode its one button offers. */
export interface CatalogTopFeaturedWork {
  creatorNames: string[];
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  /** Absent while the series has no published episode: then there is nothing to read yet. */
  latestEpisode?: {
    episodeId: string;
    orderIndex: number;
    publishedAt: string;
    title: string;
  };
  seriesId: string;
  seriesTitle: string;
}

export interface CatalogTopFeaturedAuthor {
  id: string;
  name: string;
  seriesCount: number;
}

/**
 * The popularity module's two states: the weekly chart, and the cold-start
 * shelf a tenant sees until the ranking batch has run for it.
 */
export type CatalogTopPopularSeries =
  | { kind: "ranked"; rankedSeries: RankedSeriesItem[] }
  | { kind: "recommended"; series: SeriesListItem[] };

interface CatalogTopDataOptions {
  detailFetchLimit?: number;
  /** Part of every cache key here, because the failure copy is worded in it. */
  locale: Locale;
  maxAuthors?: number;
  maxFreeSeries?: number;
  maxLabels?: number;
  maxNewEpisodes?: number;
  maxRanked?: number;
  maxRecommended?: number;
  maxScheduledSeries?: number;
  maxUpdatedSeries?: number;
  seriesLimit?: number;
}

/**
 * Newest first by absolute time. `Date.parse` would fall back to the host zone
 * for zone-less values; unparseable timestamps sort last instead of silently
 * becoming the epoch.
 */
const compareNewestFirst = (left: string, right: string): number => {
  const leftAt = parseInstant(left);
  const rightAt = parseInstant(right);
  if (!(leftAt || rightAt)) {
    return 0;
  }
  if (!leftAt) {
    return 1;
  }
  if (!rightAt) {
    return -1;
  }
  return Temporal.Instant.compare(rightAt, leftAt);
};

const byNewestDateDesc = (
  left: { publishedAt: string },
  right: { publishedAt: string }
) => compareNewestFirst(left.publishedAt, right.publishedAt);

interface SeriesDetailRow {
  creatorNames: string[];
  episodes: {
    orderIndex: number;
    publicId: string;
    publishedAt: string;
    title: string;
  }[];
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  publicId: string;
  title: string;
}

/**
 * The reads this builds on answer with results instead of throwing, so
 * a failure is carried through here as a result too — a section that could not
 * be built must say so, not quietly render the rows that happened to load.
 */
const loadSeriesDetailRows = async (
  tenantId: string,
  locale: Locale,
  seriesLimit: number,
  detailFetchLimit: number
): Promise<CachedReadResult<SeriesDetailRow[]>> => {
  const seriesPage = await listPublishedSeries(tenantId, {
    limit: seriesLimit,
    locale,
  });
  if (!seriesPage.ok) {
    return cachedReadFailure(seriesPage.message);
  }

  const seriesForDetails = seriesPage.value.series.slice(0, detailFetchLimit);

  const seriesDetails = await Promise.all(
    seriesForDetails.map(async (seriesItem) => ({
      detail: await getSeriesDetail(tenantId, seriesItem.publicId, locale),
      seriesItem,
    }))
  );

  const rows: SeriesDetailRow[] = [];
  for (const { detail, seriesItem } of seriesDetails) {
    if (!detail.ok) {
      return cachedReadFailure(detail.message);
    }

    // Unpublished between the list and detail call → skip the row.
    if (!detail.value) {
      continue;
    }

    rows.push({
      creatorNames: seriesItem.creatorNames,
      episodes: detail.value.episodes,
      eyeCatchImageVariants: seriesItem.eyeCatchImageVariants,
      publicId: seriesItem.publicId,
      title: seriesItem.title,
    });
  }

  return { ok: true, value: rows };
};

/**
 * The recommendation slot: the first page of the recommendation order.
 *
 * `seriesLimit` is not part of this read. The server orders the whole
 * catalogue, so the slot asks for one page of it rather than slicing a list
 * fetched here, and a screen that wants more keeps paging with the tokens
 * {@link listRecommendedSeries} returns.
 */
export const getCatalogTopRecommendedSeries = async (
  tenantId: string,
  { locale, maxRecommended = 6 }: CatalogTopDataOptions
): Promise<CachedReadResult<SeriesListItem[]>> => {
  "use cache";

  const page = await listRecommendedSeries(tenantId, {
    limit: maxRecommended,
    locale,
  });
  if (!page.ok) {
    return cachedReadFailure(page.message);
  }

  return { ok: true, value: page.value.series };
};

/**
 * The free-to-read slot: published series a reader can start without paying,
 * newest first.
 *
 * Which series those are is the server's `has_free_episodes` filter rather than
 * a count compared here, so a series whose last free window closes leaves the
 * shelf the moment it does, and the badge each card draws is the same number
 * the filter selected on.
 */
export const getCatalogTopFreeSeries = async (
  tenantId: string,
  { locale, maxFreeSeries = 6 }: CatalogTopDataOptions
): Promise<CachedReadResult<SeriesListItem[]>> => {
  "use cache";

  const page = await listPublishedSeries(tenantId, {
    hasFreeEpisodes: true,
    limit: maxFreeSeries,
    locale,
  });
  if (!page.ok) {
    return cachedReadFailure(page.message);
  }

  return { ok: true, value: page.value.series };
};

/** One day of the weekly schedule module, with the series expected on it. */
export interface CatalogTopScheduledDay {
  /** `EXTRACT(DOW)`: 0 is Sunday and 6 is Saturday. */
  weekday: number;
  /** Empty where the tenant publishes nothing that day. */
  series: SeriesListItem[];
}

/**
 * The weekly schedule module: the whole week at once, each day holding the
 * series that expect an episode on it, the most recently updated first.
 *
 * All seven days rather than the one being shown, because the module has to
 * answer two questions with one read. Which day is open is decided per request
 * from the tenant's clock, and whether the module exists at all is decided by
 * whether any series keeps a schedule — and a day-by-day read would have to
 * ask the server six more times to find that out.
 *
 * Which weekday it currently is deliberately does not enter here: this read is
 * cached, and a "today" resolved inside a cache scope would be pinned to
 * whenever the entry was filled. The caller reads the clock and passes the day
 * to the tab strip.
 */
export const getCatalogTopWeeklySchedule = async (
  tenantId: string,
  { locale, maxScheduledSeries = 6 }: CatalogTopDataOptions
): Promise<CachedReadResult<CatalogTopScheduledDay[]>> => {
  "use cache";

  const pages = await Promise.all(
    WEEKDAY_NUMBERS.map(async (weekday) => ({
      page: await listPublishedSeries(tenantId, {
        limit: maxScheduledSeries,
        locale,
        order: "updated",
        weekday,
      }),
      weekday,
    }))
  );

  const days: CatalogTopScheduledDay[] = [];
  for (const { page, weekday } of pages) {
    // One unreadable day makes the whole strip wrong: the reader would page
    // through a week with a silent hole in it and read the gap as "nothing
    // published that day".
    if (!page.ok) {
      return cachedReadFailure(page.message);
    }

    days.push({ series: page.value.series, weekday });
  }

  return { ok: true, value: days };
};

/**
 * What the top page's popularity module shows: the weekly chart when the batch
 * has ranked this tenant, and the recommendation order when it has not.
 *
 * The two are one module rather than two, because they answer the same
 * question and only one of them can be answered at a time. Which one it is
 * decides the module's heading and where its link goes, so the shape is a
 * union the section reads once instead of two lists it would have to compare.
 *
 * A tenant with no snapshot is the cold start every tenant begins in: the
 * batch runs daily, and until it has, `ListRecommendedSeries` is the same
 * newest-first shelf the page showed before rankings existed.
 */
export const getCatalogTopPopularSeries = async (
  tenantId: string,
  { locale, maxRanked = 10, maxRecommended = 6 }: CatalogTopDataOptions
): Promise<CachedReadResult<CatalogTopPopularSeries>> => {
  "use cache";

  const ranking = await listRankedSeries(tenantId, {
    limit: maxRanked,
    locale,
    period: "weekly",
  });
  if (!ranking.ok) {
    return cachedReadFailure(ranking.message);
  }

  if (ranking.value.rankedSeries.length > 0) {
    return {
      ok: true,
      value: { kind: "ranked", rankedSeries: ranking.value.rankedSeries },
    };
  }

  const recommended = await getCatalogTopRecommendedSeries(tenantId, {
    locale,
    maxRecommended,
  });
  if (!recommended.ok) {
    return cachedReadFailure(recommended.message);
  }

  return {
    ok: true,
    value: { kind: "recommended", series: recommended.value },
  };
};

/**
 * The work the page opens with: the head of the recommendation order, with the
 * latest episode its reading button offers.
 *
 * Which work that is has no tenant setting behind it yet, so "the first
 * recommended series" is the rule. A `null` value is an empty catalogue rather
 * than a failure — the recommendation section below says so in its own words,
 * and the opening block simply has nothing to open with.
 */
export const getCatalogTopFeaturedWork = async (
  tenantId: string,
  { locale, maxRecommended = 6 }: CatalogTopDataOptions
): Promise<CachedReadResult<CatalogTopFeaturedWork | null>> => {
  "use cache";

  const recommended = await getCatalogTopRecommendedSeries(tenantId, {
    locale,
    maxRecommended,
  });
  if (!recommended.ok) {
    return cachedReadFailure(recommended.message);
  }

  const [series] = recommended.value;
  if (!series) {
    return { ok: true, value: null };
  }

  const detail = await getSeriesDetail(tenantId, series.publicId, locale);
  if (!detail.ok) {
    return cachedReadFailure(detail.message);
  }

  const [latestEpisode] = (detail.value?.episodes ?? [])
    .filter((episode) => episode.publishedAt.trim().length > 0)
    .toSorted(byNewestDateDesc);

  return {
    ok: true,
    value: {
      creatorNames: series.creatorNames,
      eyeCatchImageVariants: series.eyeCatchImageVariants,
      latestEpisode: latestEpisode
        ? {
            episodeId: latestEpisode.publicId,
            orderIndex: latestEpisode.orderIndex,
            publishedAt: latestEpisode.publishedAt,
            title: latestEpisode.title,
          }
        : undefined,
      seriesId: series.publicId,
      seriesTitle: series.title,
    },
  };
};

export const getCatalogTopNewEpisodes = async (
  tenantId: string,
  {
    detailFetchLimit = 12,
    locale,
    maxNewEpisodes = 6,
    seriesLimit = 24,
  }: CatalogTopDataOptions
): Promise<CachedReadResult<CatalogTopEpisodeItem[]>> => {
  "use cache";

  const detailRows = await loadSeriesDetailRows(
    tenantId,
    locale,
    seriesLimit,
    detailFetchLimit
  );
  if (!detailRows.ok) {
    return cachedReadFailure(detailRows.message);
  }

  const episodes = detailRows.value
    .flatMap((row) =>
      row.episodes.flatMap((episode) =>
        episode.publishedAt.trim().length > 0
          ? [
              {
                episodeId: episode.publicId,
                episodeOrderIndex: episode.orderIndex,
                episodeTitle: episode.title,
                eyeCatchImageVariants: row.eyeCatchImageVariants,
                publishedAt: episode.publishedAt,
                seriesId: row.publicId,
                seriesTitle: row.title,
              },
            ]
          : []
      )
    )
    .toSorted(byNewestDateDesc)
    .slice(0, maxNewEpisodes);

  return { ok: true, value: episodes };
};

export const getCatalogTopUpdatedSeries = async (
  tenantId: string,
  {
    detailFetchLimit = 12,
    locale,
    maxUpdatedSeries = 6,
    seriesLimit = 24,
  }: CatalogTopDataOptions
): Promise<CachedReadResult<CatalogTopUpdatedSeriesItem[]>> => {
  "use cache";

  const detailRows = await loadSeriesDetailRows(
    tenantId,
    locale,
    seriesLimit,
    detailFetchLimit
  );
  if (!detailRows.ok) {
    return cachedReadFailure(detailRows.message);
  }

  const updatedSeries = detailRows.value
    .flatMap((row) => {
      const [latestEpisode] = row.episodes
        .filter((episode) => episode.publishedAt.trim().length > 0)
        .toSorted(byNewestDateDesc);

      if (!latestEpisode) {
        return [];
      }

      return [
        {
          creatorNames: row.creatorNames,
          eyeCatchImageVariants: row.eyeCatchImageVariants,
          latestEpisodeId: latestEpisode.publicId,
          latestEpisodeOrderIndex: latestEpisode.orderIndex,
          latestEpisodeTitle: latestEpisode.title,
          latestPublishedAt: latestEpisode.publishedAt,
          seriesId: row.publicId,
          seriesTitle: row.title,
        },
      ];
    })
    .toSorted((left, right) =>
      compareNewestFirst(left.latestPublishedAt, right.latestPublishedAt)
    )
    .slice(0, maxUpdatedSeries);

  return { ok: true, value: updatedSeries };
};

export const getCatalogTopFeaturedLabels = async (
  tenantId: string,
  { locale, maxLabels = 6 }: CatalogTopDataOptions
): Promise<CachedReadResult<LabelListItem[]>> => {
  "use cache";

  const labels = await listPublishedLabels(tenantId, {
    limit: maxLabels,
    locale,
  });
  if (!labels.ok) {
    // Re-marking the outer entry is deliberate: the inner cache life does
    // propagate, but this scope owning its own drop keeps the guarantee local.
    return cachedReadFailure(labels.message);
  }

  return { ok: true, value: labels.value.labels };
};

export const getCatalogTopFeaturedAuthors = async (
  tenantId: string,
  { locale, maxAuthors = 6 }: CatalogTopDataOptions
): Promise<CachedReadResult<CatalogTopFeaturedAuthor[]>> => {
  "use cache";

  const authorsResult = await listPublishedAuthors(tenantId, {
    limit: maxAuthors,
    locale,
  });
  if (!authorsResult.ok) {
    return cachedReadFailure(authorsResult.message);
  }

  return { ok: true, value: authorsResult.value.authors };
};
