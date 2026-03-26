import { apiClient } from "./api-client";

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

export interface SeriesDetail {
  publicId: string;
  title: string;
  synopsis: string;
  labelName: string;
  creatorNames: string[];
  readingPeriodHours: number;
}

export class SeriesNotFoundError extends Error {
  constructor() {
    super("シリーズが見つかりませんでした。");
    this.name = "SeriesNotFoundError";
  }
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
