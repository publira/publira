import { listPublishedAuthors } from "./authors";
import {
  getSeriesDetail,
  listPublishedLabels,
  listPublishedSeries,
} from "./catalog";
import type { LabelListItem } from "./catalog";
import type { SeriesListItem } from "./catalog";

export interface CatalogTopEpisodeItem {
  episodeId: string;
  episodeTitle: string;
  publishedAt: string;
  seriesId: string;
  seriesTitle: string;
}

export interface CatalogTopUpdatedSeriesItem {
  creatorNames: string[];
  latestEpisodeId: string;
  latestEpisodeTitle: string;
  latestPublishedAt: string;
  seriesId: string;
  seriesTitle: string;
}

export interface CatalogTopData {
  featuredAuthors: {
    id: string;
    name: string;
    seriesCount: number;
  }[];
  featuredLabels: LabelListItem[];
  newEpisodes: CatalogTopEpisodeItem[];
  recommendedSeries: SeriesListItem[];
  updatedSeries: CatalogTopUpdatedSeriesItem[];
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

export const getCatalogTopData = async (
  tenantPublicId: string,
  {
    detailFetchLimit = 12,
    maxAuthors = 6,
    maxLabels = 6,
    maxNewEpisodes = 6,
    maxRecommended = 6,
    maxUpdatedSeries = 6,
    seriesLimit = 24,
  }: CatalogTopDataOptions = {}
): Promise<CatalogTopData> => {
  "use cache";

  const [series, authorsResult, labels] = await Promise.all([
    listPublishedSeries(tenantPublicId, seriesLimit, 0),
    listPublishedAuthors(tenantPublicId, { page: 1, pageSize: maxAuthors }),
    listPublishedLabels(tenantPublicId, maxLabels, 0),
  ]);

  const recommendedSeries = series.slice(0, maxRecommended);

  const seriesForDetails = series.slice(0, detailFetchLimit);
  const seriesDetails = await Promise.all(
    seriesForDetails.map(async (seriesItem) => {
      try {
        const detail = await getSeriesDetail(
          tenantPublicId,
          seriesItem.publicId
        );
        return {
          creatorNames: seriesItem.creatorNames,
          episodes: detail.episodes,
          publicId: seriesItem.publicId,
          title: seriesItem.title,
        };
      } catch {
        return null;
      }
    })
  );

  const detailRows = seriesDetails.filter((item) => item !== null);

  const newEpisodes = detailRows
    .flatMap((row) =>
      row.episodes
        .filter((episode) => episode.publishedAt.trim().length > 0)
        .map((episode) => ({
          episodeId: episode.publicId,
          episodeTitle: episode.title,
          publishedAt: episode.publishedAt,
          seriesId: row.publicId,
          seriesTitle: row.title,
        }))
    )
    .toSorted(byNewestDateDesc)
    .slice(0, maxNewEpisodes);

  const updatedSeries = detailRows
    .map((row) => {
      const [latestEpisode] = row.episodes
        .filter((episode) => episode.publishedAt.trim().length > 0)
        .toSorted(byNewestDateDesc);

      if (!latestEpisode) {
        return null;
      }

      return {
        creatorNames: row.creatorNames,
        latestEpisodeId: latestEpisode.publicId,
        latestEpisodeTitle: latestEpisode.title,
        latestPublishedAt: latestEpisode.publishedAt,
        seriesId: row.publicId,
        seriesTitle: row.title,
      };
    })
    .filter((item) => item !== null)
    .toSorted(
      (left, right) =>
        toTimestamp(right.latestPublishedAt) -
        toTimestamp(left.latestPublishedAt)
    )
    .slice(0, maxUpdatedSeries);

  return {
    featuredAuthors: authorsResult.authors,
    featuredLabels: labels,
    newEpisodes,
    recommendedSeries,
    updatedSeries,
  };
};
