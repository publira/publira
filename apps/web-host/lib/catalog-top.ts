import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";
import { cachedReadFailure } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";

import { listPublishedAuthors } from "./authors";
import {
  getSeriesDetail,
  listPublishedLabels,
  listPublishedSeries,
} from "./catalog";
import type {
  EyeCatchImageVariant,
  LabelListItem,
  SeriesListItem,
} from "./catalog";

export interface CatalogTopEpisodeItem {
  episodeId: string;
  episodeTitle: string;
  publishedAt: string;
  seriesId: string;
  seriesTitle: string;
}

export interface CatalogTopUpdatedSeriesItem {
  creatorNames: string[];
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  latestEpisodeId: string;
  latestEpisodeTitle: string;
  latestPublishedAt: string;
  seriesId: string;
  seriesTitle: string;
}

export interface CatalogTopFeaturedAuthor {
  id: string;
  name: string;
  seriesCount: number;
}

interface CatalogTopDataOptions {
  detailFetchLimit?: number;
  /** Part of every cache key here, because the failure copy is worded in it. */
  locale: Locale;
  maxAuthors?: number;
  maxLabels?: number;
  maxNewEpisodes?: number;
  maxRecommended?: number;
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
    publicId: string;
    publishedAt: string;
    title: string;
  }[];
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  publicId: string;
  title: string;
}

/**
 * The reads this builds on answer with results instead of throwing (#672), so
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

export const getCatalogTopRecommendedSeries = async (
  tenantId: string,
  { locale, maxRecommended = 6, seriesLimit = 24 }: CatalogTopDataOptions
): Promise<CachedReadResult<SeriesListItem[]>> => {
  "use cache";

  const seriesPage = await listPublishedSeries(tenantId, {
    limit: seriesLimit,
    locale,
  });
  if (!seriesPage.ok) {
    return cachedReadFailure(seriesPage.message);
  }

  return { ok: true, value: seriesPage.value.series.slice(0, maxRecommended) };
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
                episodeTitle: episode.title,
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
