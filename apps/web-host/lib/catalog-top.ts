import { parseInstant } from "@publira/utils";

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

const loadSeriesDetailRows = async (
  tenantId: string,
  seriesLimit: number,
  detailFetchLimit: number
): Promise<SeriesDetailRow[]> => {
  const series = await listPublishedSeries(tenantId, seriesLimit, 0);
  const seriesForDetails = series.slice(0, detailFetchLimit);

  const seriesDetails = await Promise.all(
    seriesForDetails.map(async (seriesItem) => {
      // Unpublished between the list and detail call → skip the row.
      const detail = await getSeriesDetail(tenantId, seriesItem.publicId);
      if (!detail) {
        return null;
      }

      return {
        creatorNames: seriesItem.creatorNames,
        episodes: detail.episodes,
        eyeCatchImageVariants: seriesItem.eyeCatchImageVariants,
        publicId: seriesItem.publicId,
        title: seriesItem.title,
      };
    })
  );

  return seriesDetails.filter((item) => item !== null);
};

export const getCatalogTopRecommendedSeries = async (
  tenantId: string,
  { maxRecommended = 6, seriesLimit = 24 }: CatalogTopDataOptions = {}
): Promise<SeriesListItem[]> => {
  "use cache";

  const series = await listPublishedSeries(tenantId, seriesLimit, 0);
  return series.slice(0, maxRecommended);
};

export const getCatalogTopNewEpisodes = async (
  tenantId: string,
  {
    detailFetchLimit = 12,
    maxNewEpisodes = 6,
    seriesLimit = 24,
  }: CatalogTopDataOptions = {}
): Promise<CatalogTopEpisodeItem[]> => {
  "use cache";

  const detailRows = await loadSeriesDetailRows(
    tenantId,
    seriesLimit,
    detailFetchLimit
  );

  return detailRows
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
};

export const getCatalogTopUpdatedSeries = async (
  tenantId: string,
  {
    detailFetchLimit = 12,
    maxUpdatedSeries = 6,
    seriesLimit = 24,
  }: CatalogTopDataOptions = {}
): Promise<CatalogTopUpdatedSeriesItem[]> => {
  "use cache";

  const detailRows = await loadSeriesDetailRows(
    tenantId,
    seriesLimit,
    detailFetchLimit
  );

  return detailRows
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
};

export const getCatalogTopFeaturedLabels = async (
  tenantId: string,
  { maxLabels = 6 }: CatalogTopDataOptions = {}
): Promise<LabelListItem[]> => {
  "use cache";

  return await listPublishedLabels(tenantId, maxLabels, 0);
};

export const getCatalogTopFeaturedAuthors = async (
  tenantId: string,
  { maxAuthors = 6 }: CatalogTopDataOptions = {}
): Promise<CatalogTopFeaturedAuthor[]> => {
  "use cache";

  const authorsResult = await listPublishedAuthors(tenantId, {
    page: 1,
    pageSize: maxAuthors,
  });
  return authorsResult.authors;
};
