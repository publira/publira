import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
} from "@publira/api-client/errors";
import { EpisodeAccess } from "@publira/api-client/public/catalog";
import type { ListRecommendedSeriesResponse } from "@publira/api-client/public/catalog";
import type {
  EpisodeImage,
  Series,
  SeriesEyeCatchVariant,
} from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { cacheLife } from "next/cache";

import { apiClient, buildSessionHeaders } from "./api-client";
import {
  applyCacheTag,
  tenantAuthorsTag,
  tenantLabelsTag,
  tenantSeriesDetailTag,
  tenantSeriesListTag,
  tenantSeriesTag,
} from "./cache-tags";
import { localizedReadFailure } from "./read-failure";

export interface EyeCatchImageVariant {
  variantType: string;
  label: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

/**
 * The generated `SeriesEyeCatchVariant` fields {@link toEyeCatchImageVariants}
 * reads. Naming them against the message type is what makes a proto rename fail
 * here — a restated structural type keeps compiling, the empty string it
 * substitutes fails the check below, and the page then renders its no-image
 * placeholder with nothing pointing at the cause.
 */
type RawEyeCatchImageVariant = Pick<
  SeriesEyeCatchVariant,
  | "contentType"
  | "fileSizeBytes"
  | "height"
  | "label"
  | "url"
  | "variantType"
  | "width"
>;

export const toEyeCatchImageVariants = (
  variants: RawEyeCatchImageVariant[] | undefined
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

/**
 * The generated `Series` fields {@link toSeriesListItem} reads. Naming them
 * against the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and a storefront card then loses its label
 * and its creator names with nothing pointing at the cause.
 */
type RawSeriesListItem = Pick<
  Series,
  | "creators"
  | "eyeCatchImageUpdatedAt"
  | "eyeCatchImageVariants"
  | "label"
  | "publicId"
  | "synopsis"
  | "title"
>;

const toSeriesListItem = (s: RawSeriesListItem): SeriesListItem => ({
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
});

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

/**
 * Viewer access for an episode body. Matches `EpisodeAccess` on
 * GetEpisodeDetail: free body, paid-and-locked, or a valid purchase/ticket.
 */
export type EpisodeAccessState = "free" | "locked" | "entitled";

/**
 * Map the RPC enum onto the public-site union. Unspecified falls back to
 * price so a missing field cannot open a paid body.
 */
export const toEpisodeAccessState = (
  access: EpisodeAccess | number | undefined,
  price: number
): EpisodeAccessState => {
  if (access === EpisodeAccess.FREE) {
    return "free";
  }
  if (access === EpisodeAccess.ENTITLED) {
    return "entitled";
  }
  if (access === EpisodeAccess.LOCKED) {
    return "locked";
  }
  return price > 0 ? "locked" : "free";
};

export const isPublicEpisodeBody = (access: EpisodeAccessState): boolean =>
  access === "free";

/** The generated `EpisodeImage` fields {@link mapEpisodeImages} reads. */
type RawEpisodeImage = Pick<
  EpisodeImage,
  | "contentType"
  | "displayOrder"
  | "fileSizeBytes"
  | "height"
  | "id"
  | "imageUrl"
  | "width"
>;

const mapEpisodeImages = (
  images: RawEpisodeImage[] | undefined
): EpisodeImageItem[] =>
  (images ?? [])
    .map((image) => ({
      contentType: image.contentType ?? "",
      displayOrder: image.displayOrder ?? 0,
      fileSizeBytes: Number(image.fileSizeBytes ?? 0),
      height: image.height ?? 0,
      id: image.id ?? "",
      imageUrl: image.imageUrl ?? "",
      width: image.width ?? 0,
    }))
    .toSorted((left, right) => left.displayOrder - right.displayOrder);

export interface EpisodeSeriesSummary {
  publicId: string;
  title: string;
}

export interface SeriesDetail {
  publicId: string;
  title: string;
  synopsis: string;
  labelName: string;
  labelPublicId: string;
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

export interface SeriesListPage {
  series: SeriesListItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
}

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`. Sort order (`order`) is left at the server default — the
 * public list does not offer a sort control yet.
 */
export const listPublishedSeries = async (
  tenantId: string,
  {
    limit = 50,
    locale,
    token = "",
  }: { limit?: number; locale: Locale; token?: string }
): Promise<CachedReadResult<SeriesListPage>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.listPublishedSeries>
  >;
  try {
    response = await apiClient.catalog.listPublishedSeries({
      limit,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.series.list_failed");
  }

  const series = (response.series ?? []).map(toSeriesListItem);

  return {
    ok: true,
    value: {
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
      series,
    },
  };
};

/**
 * Published series in recommendation order: the ones the ranking snapshot names
 * first, then everything else newest first.
 *
 * The ranking is what the engagement batch builds out of reading, purchase and
 * rating signals. A tenant whose signals have not produced a snapshot yet gets
 * the newest published series alone, which is what the storefront slot showed
 * before rankings existed.
 *
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`.
 */
export const listRecommendedSeries = async (
  tenantId: string,
  {
    limit = 6,
    locale,
    token = "",
  }: { limit?: number; locale: Locale; token?: string }
): Promise<CachedReadResult<SeriesListPage>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  // These tags cover the half of the answer this app can observe: which series
  // exist and are published. The ranking snapshot itself is replaced by a batch
  // that never calls back here, so a new snapshot arrives with the cache
  // profile's own revalidation rather than with a tag.
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  let response: ListRecommendedSeriesResponse;
  try {
    response = await apiClient.catalog.listRecommendedSeries({
      limit,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.top.recommended_failed");
  }

  return {
    ok: true,
    value: {
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
      series: (response.series ?? []).map(toSeriesListItem),
    },
  };
};

export interface LabelListPage {
  labels: LabelListItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
}

/** Matches SearchPublishedSeries: empty after trim is rejected, max 100 runes. */
export const SEARCH_QUERY_MAX_LENGTH = 100;

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`. `query` is the keyword the token was built for — sending
 * a token from another query is rejected by the server.
 */
export const searchPublishedSeries = async (
  tenantId: string,
  {
    limit = 20,
    locale,
    query,
    token = "",
  }: { limit?: number; locale: Locale; query: string; token?: string }
): Promise<CachedReadResult<SeriesListPage>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.searchPublishedSeries>
  >;
  try {
    response = await apiClient.catalog.searchPublishedSeries({
      limit,
      query,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.search.failed");
  }

  const series = (response.series ?? []).map(toSeriesListItem);

  return {
    ok: true,
    value: {
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
      series,
    },
  };
};

export const listPublishedLabels = async (
  tenantId: string,
  {
    limit = 50,
    locale,
    token = "",
  }: { limit?: number; locale: Locale; token?: string }
): Promise<CachedReadResult<LabelListPage>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantLabelsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.listPublishedLabels>
  >;
  try {
    response = await apiClient.catalog.listPublishedLabels({
      limit,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.labels.list_failed");
  }

  return {
    ok: true,
    value: {
      labels: (response.labels ?? []).map((label) => ({
        eyeCatchImageUpdatedAt: label.eyeCatchImageUpdatedAt || undefined,
        eyeCatchImageVariants: toEyeCatchImageVariants(
          label.eyeCatchImageVariants
        ),
        name: label.name,
        publicId: label.publicId,
      })),
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
    },
  };
};

/**
 * `ok: true` with a `null` value when the series does not exist, is
 * unpublished, or belongs to another tenant — the server returns `not_found` or
 * `permission_denied` for those and the public site must not tell them apart.
 *
 * `ok: false` when the fetch itself failed. Neither case throws: a `"use cache"`
 * fill that throws fails the whole request, so the awaiting page never gets to
 * render either a 404 or a fallback.
 */
export const getSeriesDetail = async (
  tenantId: string,
  seriesPublicId: string,
  locale: Locale
): Promise<
  CachedReadResult<{ series: SeriesDetail; episodes: EpisodeItem[] } | null>
> => {
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
      return { ok: true, value: null };
    }
    return localizedReadFailure(error, locale, "host.series.detail_failed");
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
          labelPublicId: response.series.label?.publicId?.trim() ?? "",
          publicId: response.series.publicId ?? "",
          readingPeriodHours: response.series.readingPeriodHours ?? 0,
          synopsis: response.series.synopsis ?? "",
          title: response.series.title ?? "",
        }
      : undefined,
  };

  if (!result.series) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      episodes: result.episodes,
      series: result.series,
    },
  };
};

/**
 * `ok: true` with a `null` value when the episode is missing, unpublished, or
 * not part of `seriesPublicId`. Same `"use cache"` contract as
 * `getSeriesDetail`: a failure is a value, never a throw.
 */
export const getEpisodeDetail = async (
  tenantId: string,
  seriesPublicId: string,
  episodePublicId: string,
  locale: Locale
): Promise<
  CachedReadResult<{
    access: EpisodeAccessState;
    episode: EpisodeDetail;
    images: EpisodeImageItem[];
    series: EpisodeSeriesSummary;
  } | null>
> => {
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
      return { ok: true, value: null };
    }
    return localizedReadFailure(error, locale, "host.episode.detail_failed");
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
    return { ok: true, value: null };
  }

  const episode = {
    orderIndex: response.episode.orderIndex,
    price: response.episode.price,
    publicId: response.episode.publicId,
    publishedAt: response.episode.publishedAt,
    readingPeriodHours: response.episode.readingPeriodHours ?? 0,
    scheduledAt: response.episode.scheduledAt,
    status: response.episode.status,
    title: response.episode.title,
  };

  return {
    ok: true,
    value: {
      access: toEpisodeAccessState(response.access, episode.price),
      episode,
      images: mapEpisodeImages(response.images),
      series,
    },
  };
};

/**
 * Session-aware body for a paid episode. Shared `getEpisodeDetail` is
 * anonymous, so a ticket or purchase never appears there — this private read
 * sends the bearer and returns entitled images or a locked gate.
 *
 * `accessToken` is an argument so the private cache key includes the session
 * and the caller does not resolve cookies twice. Guests skip the RPC: no
 * token means locked, same as the server would answer without a bearer.
 */
export const getEpisodeViewer = async (
  tenantId: string,
  seriesPublicId: string,
  episodePublicId: string,
  accessToken: string,
  locale: Locale,
  checkoutSessionId = ""
): Promise<
  CachedReadResult<{
    access: EpisodeAccessState;
    images: EpisodeImageItem[];
  } | null>
> => {
  "use cache: private";
  try {
    cacheLife({ stale: 30 });
  } catch {
    // Unit tests run without the Next.js cache runtime, same as applyCacheTag.
  }

  const normalizedTenantId = tenantId.trim();
  const normalizedSeriesPublicId = seriesPublicId.trim();
  const normalizedEpisodePublicId = episodePublicId.trim();
  applyCacheTag(tenantSeriesDetailTag(normalizedTenantId));
  applyCacheTag(tenantSeriesTag(normalizedTenantId, normalizedSeriesPublicId));

  const sessionId = accessToken.trim();
  // The return URL carries Stripe's opaque session ID. Including it in this
  // private cache key makes the first post-payment reader check fresh rather
  // than reusing the locked body cached before Checkout.
  void checkoutSessionId.trim();
  if (!sessionId) {
    return { ok: true, value: { access: "locked", images: [] } };
  }

  let response;
  try {
    response = await apiClient.catalog.getEpisodeDetail(
      {
        publicId: normalizedEpisodePublicId,
        tenant: { tenantId: normalizedTenantId },
      },
      buildSessionHeaders(sessionId)
    );
  } catch (error) {
    // The public read already established this episode exists. A
    // permission_denied here is a body-access denial, not an existence
    // question, so it must not become notFound() on a page that already
    // showed the title.
    if (isRpcError(error, Code.PermissionDenied)) {
      return { ok: true, value: { access: "locked", images: [] } };
    }
    if (isMissingResourceRpcError(error)) {
      return { ok: true, value: null };
    }
    return localizedReadFailure(error, locale, "host.episode.detail_failed");
  }

  const seriesPublicIdFromResponse = response.series?.publicId ?? "";
  if (
    !response.episode ||
    seriesPublicIdFromResponse !== normalizedSeriesPublicId
  ) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      access: toEpisodeAccessState(response.access, response.episode.price),
      images: mapEpisodeImages(response.images),
    },
  };
};
