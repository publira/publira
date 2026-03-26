import { apiClient } from "./api-client";
import { EpisodeNotFoundError } from "./errors";
import { SeriesNotFoundError } from "./series-not-found-error";

export { EpisodeNotFoundError, SeriesNotFoundError };

export interface SeriesListItem {
  publicId: string;
  title: string;
  synopsis: string;
  labelName: string;
  creatorNames: string[];
}

export interface EpisodeItem {
  publicId: string;
  title: string;
  orderIndex: number;
  price: number;
  status: string;
  publishedAt: string;
}

export interface EpisodeImageItem {
  contentType: string;
  displayOrder: number;
  fileSizeBytes: number;
  height: number;
  id: string;
  imageUrl: string;
  width: number;
}

export interface EpisodeDetail {
  orderIndex: number;
  price: number;
  publicId: string;
  publishedAt: string;
  readingPeriodHours: number;
  scheduledAt: string;
  status: string;
  title: string;
}

export interface EpisodeSeriesSummary {
  publicId: string;
  title: string;
}

export interface SeriesDetail {
  publicId: string;
  title: string;
  synopsis: string;
  labelName: string;
  creatorNames: string[];
  readingPeriodHours: number;
}

export const listPublishedSeries = async (
  tenantPublicId: string,
  limit = 50,
  offset = 0
): Promise<SeriesListItem[]> => {
  "use cache";

  const response = await apiClient.catalog.listPublishedSeries({
    limit,
    offset,
    tenant: { tenantPublicId },
  });

  return (response.series ?? []).map((s) => ({
    creatorNames: (s.creators ?? [])
      .map((c) => c.name.trim())
      .filter((n) => n.length > 0),
    labelName: s.label?.name?.trim() ?? "",
    publicId: s.publicId,
    synopsis: s.synopsis,
    title: s.title,
  }));
};

export const getSeriesDetail = async (
  tenantPublicId: string,
  seriesPublicId: string
): Promise<{ series: SeriesDetail; episodes: EpisodeItem[] }> => {
  "use cache";

  const response = await apiClient.catalog.getSeriesDetail({
    publicId: seriesPublicId,
    tenant: { tenantPublicId },
  });

  const result = {
    episodes: (response.episodes ?? [])
      .map((e) => ({
        orderIndex: e.orderIndex,
        price: e.price,
        publicId: e.publicId,
        publishedAt: e.publishedAt,
        status: e.status,
        title: e.title,
      }))
      .toSorted((a, b) => a.orderIndex - b.orderIndex),
    series: response.series
      ? {
          creatorNames: (response.series.creators ?? [])
            .map((c) => c.name.trim())
            .filter((n) => n.length > 0),
          labelName: response.series.label?.name?.trim() ?? "",
          publicId: response.series.publicId,
          readingPeriodHours: response.series.readingPeriodHours ?? 0,
          synopsis: response.series.synopsis,
          title: response.series.title,
        }
      : undefined,
  };

  if (!result.series) {
    throw new SeriesNotFoundError();
  }

  return {
    episodes: result.episodes,
    series: result.series,
  };
};

export const getEpisodeDetail = async (
  tenantPublicId: string,
  seriesPublicId: string,
  episodePublicId: string
): Promise<{
  episode: EpisodeDetail;
  images: EpisodeImageItem[];
  series: EpisodeSeriesSummary;
}> => {
  "use cache";

  const response = await apiClient.catalog.getEpisodeDetail({
    publicId: episodePublicId,
    tenant: { tenantPublicId },
  });

  const series = response.series
    ? {
        publicId: response.series.publicId,
        title: response.series.title,
      }
    : undefined;

  if (!response.episode || !series || series.publicId !== seriesPublicId) {
    throw new EpisodeNotFoundError();
  }

  return {
    episode: {
      orderIndex: response.episode.orderIndex,
      price: response.episode.price,
      publicId: response.episode.publicId,
      publishedAt: response.episode.publishedAt,
      readingPeriodHours: response.episode.readingPeriodHours ?? 0,
      scheduledAt: response.episode.scheduledAt,
      status: response.episode.status,
      title: response.episode.title,
    },
    images: (response.images ?? [])
      .map((image) => ({
        contentType: image.contentType,
        displayOrder: image.displayOrder,
        fileSizeBytes: Number(image.fileSizeBytes),
        height: image.height,
        id: image.id,
        imageUrl: image.imageUrl,
        width: image.width,
      }))
      .toSorted((left, right) => left.displayOrder - right.displayOrder),
    series,
  };
};
