import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import {
  EpisodeAccess,
  RankingPeriod,
  SeriesOrder,
} from "@publira/api-client/public/catalog";
import type {
  ListRankedSeriesResponse,
  ListRecommendedSeriesResponse,
  ListRelatedSeriesResponse,
  PublishedGenre,
  PublishedTag,
} from "@publira/api-client/public/catalog";
import { SeriesStatus } from "@publira/api-client/public/types";
import type {
  EpisodeImage,
  EpisodeNeighbor,
  Label,
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
  /**
   * How many published episodes of this series a reader can open without
   * paying, counted by the server at the moment of the read: the ones priced
   * at 0, and the priced ones an open free window covers. Zero is a series
   * that costs money from its first episode.
   */
  freeEpisodeCount: number;
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
  | "freeEpisodeCount"
  | "label"
  | "publicId"
  | "synopsis"
  | "title"
>;

export const toSeriesListItem = (s: RawSeriesListItem): SeriesListItem => ({
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
  freeEpisodeCount: s.freeEpisodeCount ?? 0,
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

/**
 * A published episode next to the one being read, in the same series.
 *
 * `isFree` rather than `price === 0`: a priced episode inside an open free
 * window is readable right now, and `price` is what it costs again once that
 * window closes. A link that read the price alone would call such an episode
 * paid on the way in and then open it for nothing.
 */
export interface EpisodeNeighborItem {
  isFree: boolean;
  orderIndex: number;
  price: number;
  publicId: string;
  title: string;
}

/** The generated `EpisodeNeighbor` fields {@link mapEpisodeNeighbor} reads. */
type RawEpisodeNeighbor = Pick<
  EpisodeNeighbor,
  "isFree" | "orderIndex" | "price" | "publicId" | "title"
>;

/**
 * `undefined` at the ends of a series, which is what the server sends when
 * there is no episode on that side, and also what a neighbour with no
 * `public_id` has to become: nothing can link to it.
 */
const mapEpisodeNeighbor = (
  neighbor: RawEpisodeNeighbor | undefined
): EpisodeNeighborItem | undefined => {
  const publicId = neighbor?.publicId ?? "";
  if (!neighbor || !publicId) {
    return undefined;
  }

  return {
    isFree: neighbor.isFree ?? false,
    orderIndex: neighbor.orderIndex ?? 0,
    price: neighbor.price ?? 0,
    publicId,
    title: neighbor.title ?? "",
  };
};

export interface EpisodeSeriesSummary {
  /**
   * The work's artwork. Episodes carry none of their own, so it is what a link
   * to a neighbouring episode shows at the head of its row.
   */
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  publicId: string;
  title: string;
}

/**
 * Whether a series is still gaining episodes, as a name a screen can branch
 * on. `undefined` where the tenant has not said, which is a state a reader is
 * told nothing about rather than one worded as "unknown".
 */
export type SeriesSerializationStatus = "completed" | "hiatus" | "ongoing";

const toSeriesSerializationStatus = (
  status: SeriesStatus | undefined
): SeriesSerializationStatus | undefined => {
  switch (status) {
    case SeriesStatus.ONGOING: {
      return "ongoing";
    }
    case SeriesStatus.COMPLETED: {
      return "completed";
    }
    case SeriesStatus.HIATUS: {
      return "hiatus";
    }
    default: {
      return undefined;
    }
  }
};

export interface SeriesDetail {
  publicId: string;
  title: string;
  synopsis: string;
  labelName: string;
  labelPublicId: string;
  creatorNames: string[];
  status?: SeriesSerializationStatus;
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

/**
 * The generated `Label` fields {@link toLabelListItem} reads. Naming them
 * against the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and a label row then renders nameless with
 * nothing pointing at the cause.
 */
type RawLabelListItem = Pick<
  Label,
  "eyeCatchImageUpdatedAt" | "eyeCatchImageVariants" | "name" | "publicId"
>;

export const toLabelListItem = (label: RawLabelListItem): LabelListItem => ({
  eyeCatchImageUpdatedAt: label.eyeCatchImageUpdatedAt || undefined,
  eyeCatchImageVariants: toEyeCatchImageVariants(label.eyeCatchImageVariants),
  name: label.name,
  publicId: label.publicId,
});

export interface SeriesListPage {
  series: SeriesListItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
}

/**
 * The sort a reader can pick, as the URL names it. Three of the five orders
 * `SeriesOrder` defines: a storefront asks for the newest, for the ones that
 * just gained an episode, and for the alphabet, and the reverse of each answers
 * no question of its own.
 */
export type SeriesListOrder = "newest" | "title" | "updated";

const seriesOrders: Record<SeriesListOrder, SeriesOrder> = {
  newest: SeriesOrder.PUBLISHED_AT_DESC,
  title: SeriesOrder.TITLE_ASC,
  updated: SeriesOrder.LATEST_EPISODE_AT_DESC,
};

const seriesStatusFilters: Record<SeriesSerializationStatus, SeriesStatus> = {
  completed: SeriesStatus.COMPLETED,
  hiatus: SeriesStatus.HIATUS,
  ongoing: SeriesStatus.ONGOING,
};

/**
 * How a published series list is narrowed and ordered.
 *
 * Every one of these is the server's. The states and counts they select on are
 * settled per read, so a list narrowed here would keep a series whose last free
 * window closed, or whose genre was taken off it, since the page was filled.
 *
 * A cursor token carries the order and the filters it was built for, so a
 * caller that changes any of them starts at page one again (`proto/README.md`).
 */
export interface SeriesListFilters {
  /** Empty applies no genre filter. */
  genrePublicId?: string;
  /** Keep only the series a reader can start without paying. */
  hasFreeEpisodes?: boolean;
  order?: SeriesListOrder;
  /** `undefined` applies no status filter, which is every state. */
  status?: SeriesSerializationStatus;
  /** Empty applies no tag filter. */
  tagSlug?: string;
}

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`.
 *
 * A `genrePublicId` or `tagSlug` naming nothing of this tenant is `not_found`
 * on the RPC rather than an empty page, and arrives here as the read failure
 * every other RPC error does. The two screens that fix one resolve it against
 * {@link listPublishedGenres} / {@link findPublishedTagBySlug} first, so a URL
 * naming a genre nobody curates answers `notFound()` instead of a sentence
 * about the catalog being unavailable.
 */
export const listPublishedSeries = async (
  tenantId: string,
  {
    genrePublicId = "",
    hasFreeEpisodes = false,
    limit = 50,
    locale,
    order = "newest",
    status,
    tagSlug = "",
    token = "",
  }: SeriesListFilters & {
    limit?: number;
    locale: Locale;
    token?: string;
  }
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
      genrePublicId,
      hasFreeEpisodes,
      limit,
      order: seriesOrders[order],
      status: status ? seriesStatusFilters[status] : SeriesStatus.UNSPECIFIED,
      tagSlug,
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

/** One genre the tenant curates, beside how many of its series are published. */
export interface PublishedGenreItem {
  publicId: string;
  name: string;
  slug: string;
  publishedSeriesCount: number;
}

/** The generated `PublishedGenre` fields {@link toPublishedGenreItem} reads. */
type RawPublishedGenre = Pick<
  PublishedGenre,
  "name" | "publicId" | "publishedSeriesCount" | "slug"
>;

const toPublishedGenreItem = (
  genre: RawPublishedGenre
): PublishedGenreItem => ({
  name: genre.name?.trim() ?? "",
  publicId: genre.publicId ?? "",
  publishedSeriesCount: genre.publishedSeriesCount ?? 0,
  slug: genre.slug ?? "",
});

/**
 * Every genre of the tenant, in the order the console put them in.
 *
 * The whole list rather than one page: a genre row is a name and a count, the
 * set is curated small enough to browse, and the three places that read it —
 * the browse page, the chips on the home page, and the filter on the series
 * list — each want all of it. Paging it would give the reader a "next page" of
 * a classification the tenant arranged to be seen at once.
 *
 * A genre no published series carries is still in it, because the URL of its
 * page has to keep working after its last series is taken down. That is also
 * what makes this the lookup the genre pages resolve their id against: a genre
 * missing here is a genre the tenant does not have.
 */
export const listPublishedGenres = async (
  tenantId: string,
  locale: Locale
): Promise<CachedReadResult<PublishedGenreItem[]>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  // The tag the admin console drops when a genre is created, renamed, or
  // reordered, and when a series changes the genres it carries.
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));

  const genres: PublishedGenreItem[] = [];
  try {
    await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.catalog.listPublishedGenres({
          limit,
          tenant: { tenantId: normalizedTenantId },
          token,
        });
        return {
          items: response.genres ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          genres.push(toPublishedGenreItem(item));
        }
      }
    );
  } catch (error) {
    return localizedReadFailure(error, locale, "host.genres.list_failed");
  }

  return { ok: true, value: genres };
};

/** One tag at least one published series carries, beside how many carry it. */
export interface PublishedTagItem {
  name: string;
  slug: string;
  publishedSeriesCount: number;
}

/** The generated `PublishedTag` fields {@link toPublishedTagItem} reads. */
type RawPublishedTag = Pick<
  PublishedTag,
  "name" | "publishedSeriesCount" | "slug"
>;

const toPublishedTagItem = (tag: RawPublishedTag): PublishedTagItem => ({
  name: tag.name?.trim() ?? "",
  publishedSeriesCount: tag.publishedSeriesCount ?? 0,
  slug: tag.slug ?? "",
});

/**
 * The tag a slug names, or `null` when no published series carries it.
 *
 * A tag is addressed by its slug, and the slug is the identity of a name
 * rather than a second name, so the page a reader lands on has to read the tag
 * back to say what it is called. There is no RPC that takes one slug —
 * `ListPublishedTags` is the whole vocabulary — so the walk stops at the match
 * instead of collecting a list nothing else on the page uses.
 *
 * `null` is the answer for a tag nothing published carries as well as for one
 * that never existed, and the tag page answers both with `notFound()`: a tag
 * exists because a series carries it, so one no published series carries has
 * no page to keep working.
 */
export const findPublishedTagBySlug = async (
  tenantId: string,
  slug: string,
  locale: Locale
): Promise<CachedReadResult<PublishedTagItem | null>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  const normalizedSlug = slug.trim();
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));

  let match: PublishedTagItem | null = null;
  try {
    await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.catalog.listPublishedTags({
          limit,
          tenant: { tenantId: normalizedTenantId },
          token,
        });
        return {
          items: response.tags ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        const found = items.find((item) => item.slug === normalizedSlug);
        if (found) {
          match = toPublishedTagItem(found);
          return false;
        }
      }
    );
  } catch (error) {
    return localizedReadFailure(error, locale, "host.tags.detail_failed");
  }

  return { ok: true, value: match };
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

/**
 * The tenant's other published series, the most related to `seriesPublicId`
 * first.
 *
 * Relatedness is the server's: shared creators weigh most, then the label, then
 * each genre and each tag. The list does not stop at the related ones — a
 * series sharing nothing still takes its place among the rest, in the ranking
 * order the storefront uses — so the strip under a brand new title shows what
 * the tenant's readers are reading rather than nothing at all.
 *
 * A subject series that is missing, unpublished, or another tenant's answers
 * with an empty page. That is the "nothing" value rather than a failure: it is
 * what the section has to show when the series it hangs under goes away between
 * two reads, and it is cacheable.
 *
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`. A token carries the series it was scored against, so it
 * cannot be continued under a different one.
 */
export const listRelatedSeries = async (
  tenantId: string,
  {
    limit = 4,
    locale,
    seriesPublicId,
    token = "",
  }: {
    limit?: number;
    locale: Locale;
    seriesPublicId: string;
    token?: string;
  }
): Promise<CachedReadResult<SeriesListPage>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  const normalizedSeriesPublicId = seriesPublicId.trim();
  // Which series are published decides the tail of the answer, and the subject
  // series' own label, genres and tags decide the order of the head, so an edit
  // to either is what this entry has to follow. The ranking that breaks the
  // ties is replaced by a batch that never calls back here, so a new snapshot
  // arrives with the cache profile's own revalidation rather than with a tag.
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));
  applyCacheTag(tenantSeriesTag(normalizedTenantId, normalizedSeriesPublicId));

  let response: ListRelatedSeriesResponse;
  try {
    response = await apiClient.catalog.listRelatedSeries({
      limit,
      seriesPublicId: normalizedSeriesPublicId,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return {
        ok: true,
        value: { nextToken: "", previousToken: "", series: [] },
      };
    }
    return localizedReadFailure(error, locale, "host.related.list_failed");
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

/** The window a ranking snapshot covers, as the site names it in a URL. */
export type RankingPeriodName = "daily" | "weekly";

/** One series at the position the snapshot gave it. */
export interface RankedSeriesItem {
  rank: number;
  /**
   * The position the series held in the period before this one. Absent when
   * there is no earlier snapshot, and when that snapshot did not rank this
   * series — a new entry has no movement to draw, which is not the same as
   * having moved from position 0.
   */
  previousRank?: number;
  series: SeriesListItem;
}

export interface RankedSeriesPage {
  rankedSeries: RankedSeriesItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
  /**
   * When the batch computed the snapshot this page comes from (RFC 3339).
   * Empty when the tenant has no snapshot yet, which is what tells an empty
   * chart apart from the last page of one.
   */
  computedAt: string;
  /** The ranked window as calendar dates in the tenant's time zone. */
  periodStart: string;
  periodEnd: string;
}

const rankingPeriods: Record<RankingPeriodName, RankingPeriod> = {
  daily: RankingPeriod.DAILY,
  weekly: RankingPeriod.WEEKLY,
};

/**
 * One page of the latest ranking snapshot for a period, in the positions that
 * snapshot recorded.
 *
 * Unlike {@link listRecommendedSeries} this is the leaderboard itself: only
 * what the batch ranked, at the positions it assigned, so a series unpublished
 * since the snapshot was written leaves a gap rather than pulling the rest of
 * the chart up. A tenant the batch has not ranked yet answers with an empty
 * page and an empty `computedAt` instead of an error.
 *
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`. A token carries the period it was built for, so changing
 * the period restarts at page 1.
 */
export const listRankedSeries = async (
  tenantId: string,
  {
    limit = 20,
    locale,
    period,
    token = "",
  }: {
    limit?: number;
    locale: Locale;
    period: RankingPeriodName;
    token?: string;
  }
): Promise<CachedReadResult<RankedSeriesPage>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  // The two tags `listRecommendedSeries` carries, for the same reason: they
  // cover which series exist and are published, while the snapshot itself is
  // replaced by a batch that never calls back here and therefore arrives with
  // the cache profile's own revalidation.
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  let response: ListRankedSeriesResponse;
  try {
    response = await apiClient.catalog.listRankedSeries({
      limit,
      period: rankingPeriods[period],
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.ranking.list_failed");
  }

  const rankedSeries = (response.rankedSeries ?? []).flatMap((ranked) =>
    ranked.series
      ? [
          {
            previousRank: ranked.previousRank,
            rank: ranked.rank,
            series: toSeriesListItem(ranked.series),
          },
        ]
      : []
  );

  return {
    ok: true,
    value: {
      computedAt: response.computedAt ?? "",
      nextToken: response.nextToken ?? "",
      periodEnd: response.periodEnd ?? "",
      periodStart: response.periodStart ?? "",
      previousToken: response.previousToken ?? "",
      rankedSeries,
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
    return localizedReadFailure(error, locale, "host.search.series_failed");
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
      labels: (response.labels ?? []).map(toLabelListItem),
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
    },
  };
};

/**
 * Labels whose name matches, narrowed to the ones that still hold a published
 * series — which is what separates this from {@link getPublishedLabelDetail},
 * an address that keeps answering after the last series behind it comes down.
 * A publish therefore changes the answer, so the series list tag invalidates it
 * alongside the label tag.
 *
 * Cursor pagination as {@link searchPublishedSeries}, including the rule that a
 * token belongs to the query it was built for.
 */
export const searchPublishedLabels = async (
  tenantId: string,
  {
    limit = 20,
    locale,
    query,
    token = "",
  }: { limit?: number; locale: Locale; query: string; token?: string }
): Promise<CachedReadResult<LabelListPage>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantLabelsTag(normalizedTenantId));
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.searchPublishedLabels>
  >;
  try {
    response = await apiClient.catalog.searchPublishedLabels({
      limit,
      query,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.search.labels_failed");
  }

  return {
    ok: true,
    value: {
      labels: (response.labels ?? []).map(toLabelListItem),
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
          status: toSeriesSerializationStatus(response.series.status),
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
    nextEpisode: EpisodeNeighborItem | undefined;
    previousEpisode: EpisodeNeighborItem | undefined;
    series: EpisodeSeriesSummary;
  } | null>
> => {
  "use cache";
  try {
    // A free episode's image URLs carry the key material its pages are
    // encrypted under, which rotates daily and is guaranteed to be good for at
    // least a day. This entry is shared by every reader, and the default
    // profile would let it be served indefinitely once nothing revalidates it,
    // so it is bounded well under that floor: no reader is handed material
    // that has already rotated away.
    cacheLife({ expire: 3600, revalidate: 900 });
  } catch {
    // Unit tests run without the Next.js cache runtime, same as applyCacheTag.
  }

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
        eyeCatchImageVariants: toEyeCatchImageVariants(
          response.series.eyeCatchImageVariants
        ),
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
      nextEpisode: mapEpisodeNeighbor(response.nextEpisode),
      previousEpisode: mapEpisodeNeighbor(response.previousEpisode),
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
