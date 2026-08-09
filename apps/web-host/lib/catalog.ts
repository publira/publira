import { isMissingResourceRpcError } from "@publira/api-client/errors";

import { apiClient } from "./api-client";
import {
  applyCacheTag,
  tenantAuthorsTag,
  tenantSeriesDetailTag,
  tenantSeriesListTag,
  tenantSeriesTag,
} from "./cache-tags";

export interface EyeCatchImageVariant {
  variantType: string;
  label: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

const toEyeCatchImageVariants = (
  variants:
    | {
        variantType?: string;
        label?: string;
        url?: string;
        contentType?: string;
        width?: number;
        height?: number;
        fileSizeBytes?: bigint | number;
      }[]
    | undefined
): EyeCatchImageVariant[] | undefined => {
  const mapped = (variants ?? []).flatMap((variant) => {
    const mappedVariant = {
      contentType: variant.contentType ?? "",
      fileSizeBytes: Number(variant.fileSizeBytes ?? 0),
      height: variant.height ?? 0,
      label: variant.label ?? "",
      url: variant.url ?? "",
      variantType: variant.variantType ?? "",
      width: variant.width ?? 0,
    };
    return mappedVariant.label.length > 0 && mappedVariant.url.length > 0
      ? [mappedVariant]
      : [];
  });

  return mapped.length > 0 ? mapped : undefined;
};

export interface SeriesListItem {
  publicId: string;
  title: string;
  synopsis: string;
  labelName: string;
  labelPublicId?: string;
  eyeCatchImageUpdatedAt?: string;
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  creators: {
    publicId: string;
    name: string;
    profileText: string;
    iconImageUrl: string;
  }[];
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
  eyeCatchImageUpdatedAt?: string;
  eyeCatchImageVariants?: EyeCatchImageVariant[];
}

export interface LabelListItem {
  publicId: string;
  name: string;
  eyeCatchImageUpdatedAt?: string;
  eyeCatchImageVariants?: EyeCatchImageVariant[];
}

export const listPublishedSeries = async (
  tenantId: string,
  limit = 50,
  offset = 0
): Promise<SeriesListItem[]> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  const response = await apiClient.catalog.listPublishedSeries({
    limit,
    offset,
    tenant: { tenantId },
  });

  return (response.series ?? []).map((s) => ({
    creatorNames: (s.creators ?? []).flatMap((c) => {
      const name = (c.name ?? "").trim();
      return name.length > 0 ? [name] : [];
    }),
    creators: (s.creators ?? []).flatMap((c) => {
      const name = (c.name ?? "").trim();
      return name.length > 0
        ? [
            {
              iconImageUrl: c.iconImageUrl?.trim() ?? "",
              name,
              profileText: (c.profileText ?? "").trim(),
              publicId: c.publicId ?? "",
            },
          ]
        : [];
    }),
    eyeCatchImageUpdatedAt: s.eyeCatchImageUpdatedAt || undefined,
    eyeCatchImageVariants: toEyeCatchImageVariants(s.eyeCatchImageVariants),
    labelName: s.label?.name?.trim() ?? "",
    labelPublicId: s.label?.publicId?.trim() ?? "",
    publicId: s.publicId,
    synopsis: s.synopsis,
    title: s.title,
  }));
};

export const listPublishedLabels = async (
  tenantId: string,
  limit = 50,
  offset = 0
): Promise<LabelListItem[]> => {
  "use cache";

  const response = await apiClient.catalog.listPublishedLabels({
    limit,
    offset,
    tenant: { tenantId },
  });

  return (response.labels ?? []).map((label) => ({
    eyeCatchImageUpdatedAt: label.eyeCatchImageUpdatedAt || undefined,
    eyeCatchImageVariants: toEyeCatchImageVariants(label.eyeCatchImageVariants),
    name: label.name,
    publicId: label.publicId,
  }));
};

/**
 * `null` when the series does not exist, is unpublished, or belongs to another
 * tenant — the server returns `not_found` or `permission_denied` for those and
 * the public site must not tell them apart.
 *
 * Returns `null` rather than throwing because this runs inside a `"use cache"`
 * scope, where a thrown error is not observable by the caller's `try` / `catch`
 * and fails the whole request instead.
 */
export const getSeriesDetail = async (
  tenantId: string,
  seriesPublicId: string
): Promise<{ series: SeriesDetail; episodes: EpisodeItem[] } | null> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  const normalizedSeriesPublicId = seriesPublicId.trim();
  applyCacheTag(tenantSeriesDetailTag(normalizedTenantId));
  applyCacheTag(tenantSeriesTag(normalizedTenantId, normalizedSeriesPublicId));

  let response;
  try {
    response = await apiClient.catalog.getSeriesDetail({
      publicId: normalizedSeriesPublicId,
      tenant: { tenantId: normalizedTenantId },
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return null;
    }
    throw error;
  }

  const result = {
    episodes: (response.episodes ?? [])
      .map((e) => ({
        orderIndex: e.orderIndex ?? 0,
        price: e.price ?? 0,
        publicId: e.publicId ?? "",
        publishedAt: e.publishedAt ?? "",
        status: e.status ?? "",
        title: e.title ?? "",
      }))
      .toSorted((a, b) => a.orderIndex - b.orderIndex),
    series: response.series
      ? {
          creatorNames: (response.series.creators ?? []).flatMap((c) => {
            const name = (c.name ?? "").trim();
            return name.length > 0 ? [name] : [];
          }),
          eyeCatchImageUpdatedAt:
            response.series.eyeCatchImageUpdatedAt || undefined,
          eyeCatchImageVariants: toEyeCatchImageVariants(
            response.series.eyeCatchImageVariants
          ),
          labelName: response.series.label?.name?.trim() ?? "",
          publicId: response.series.publicId ?? "",
          readingPeriodHours: response.series.readingPeriodHours ?? 0,
          synopsis: response.series.synopsis ?? "",
          title: response.series.title ?? "",
        }
      : undefined,
  };

  if (!result.series) {
    return null;
  }

  return {
    episodes: result.episodes,
    series: result.series,
  };
};

/**
 * `null` when the episode is missing, unpublished, or not part of
 * `seriesPublicId`. Same `"use cache"` constraint as `getSeriesDetail`.
 */
export const getEpisodeDetail = async (
  tenantId: string,
  seriesPublicId: string,
  episodePublicId: string
): Promise<{
  episode: EpisodeDetail;
  images: EpisodeImageItem[];
  series: EpisodeSeriesSummary;
} | null> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  const normalizedSeriesPublicId = seriesPublicId.trim();
  const normalizedEpisodePublicId = episodePublicId.trim();
  applyCacheTag(tenantSeriesDetailTag(normalizedTenantId));
  applyCacheTag(tenantSeriesTag(normalizedTenantId, normalizedSeriesPublicId));

  let response;
  try {
    response = await apiClient.catalog.getEpisodeDetail({
      publicId: normalizedEpisodePublicId,
      tenant: { tenantId: normalizedTenantId },
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return null;
    }
    throw error;
  }

  const series = response.series
    ? {
        publicId: response.series.publicId,
        title: response.series.title,
      }
    : undefined;

  if (
    !response.episode ||
    !series ||
    series.publicId !== normalizedSeriesPublicId
  ) {
    return null;
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
