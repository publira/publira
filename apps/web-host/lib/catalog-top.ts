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

const toTimestamp = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const byNewestDateDesc = (
  left: { publishedAt: string },
  right: { publishedAt: string }
) => toTimestamp(right.publishedAt) - toTimestamp(left.publishedAt);

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
      try {
        const detail = await getSeriesDetail(tenantId, seriesItem.publicId);
        return {
          creatorNames: seriesItem.creatorNames,
          episodes: detail.episodes,
          eyeCatchImageVariants: seriesItem.eyeCatchImageVariants,
          publicId: seriesItem.publicId,
          title: seriesItem.title,
        };
      } catch {
        return null;
      }
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
    .toSorted(
      (left, right) =>
        toTimestamp(right.latestPublishedAt) -
        toTimestamp(left.latestPublishedAt)
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
