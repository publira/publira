import { EpisodeCreditUnchangedReason } from "@publira/api-client/admin/series";
import type {
  GetEpisodeResponse,
  UpdateEpisodeLayoutResponse,
} from "@publira/api-client/admin/series";
import { CreatorCreditSource } from "@publira/api-client/admin/types";
import type {
  Creator,
  Episode,
  EpisodeImage,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  RPC_ERROR_REASON,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { toEpisodeTranslations } from "./catalog-translation";
import type { EpisodeTranslationItem } from "./catalog-translation";
import type { CropRect } from "./crop-rect";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import {
  mentionsAspectImageRejection,
  mentionsStorageNotConfigured,
} from "./image-rejection";
import { getMessagesFor } from "./messages";
import type { PurchaseAvailabilityOverride } from "./purchase-availability";
import {
  READING_DIRECTION_ENUM,
  toReadingDirectionValue,
} from "./reading-direction-enum";
import type { EpisodeReadingLayoutOverrides } from "./reading-layout";
import { getAccessToken } from "./session";
import type { EpisodeAvailabilityOverride } from "./surface-availability";
import {
  SURFACE_AVAILABILITY_ENUM,
  toSurfaceAvailabilityOverrideEnum,
  toSurfaceAvailabilityValue,
} from "./surface-availability-enum";

export interface EpisodeItem {
  id: string;
  publicId: string;
  title: string;
  orderIndex: number;
  price: number;
  readingPeriodHours: number;
  /**
   * What renting the episode costs and how many hours a rental opens it for,
   * both 0 on an episode that is not rented.
   */
  rentalPrice: number;
  rentalPeriodHours: number;
  status: string;
  scheduledAt: string;
  publishedAt: string;
  /**
   * Which surfaces the episode states of its own, empty where it follows its
   * series. It is the override rather than where the episode ends up, because
   * the series bounds it: see `episodeShownOn`.
   */
  availability: EpisodeAvailabilityOverride;
  /**
   * The episode's own eye-catch, empty when it has none and its series' stands
   * in for it.
   */
  eyeCatchImageVariants: {
    variantType: string;
    label: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    fileSizeBytes: number;
  }[];
  eyeCatchImageUpdatedAt: string;
}

export interface EpisodeImageItem {
  id: string;
  imageUrl: string;
  contentType: string;
  fileSizeBytes: string;
  displayOrder: number;
  width: number;
  height: number;
}

export type CreateEpisodeResult =
  | { ok: true; episode: EpisodeItem }
  | { ok: false; message: string };

export type ListEpisodesResult = CursorPageTokens &
  (
    | { ok: true; episodes: EpisodeItem[] }
    | { ok: false; message: string; episodes: EpisodeItem[] }
  );

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing episode from
 * another tenant's episode would leak whether it exists.
 */
export type GetEpisodeResult =
  | {
      ok: true;
      episode: EpisodeItem;
      /**
       * What the episode states of its own, apart from the layout it resolves
       * to: the form offers following the series as a choice, so it needs to
       * know which values are the series' rather than what they add up to.
       */
      layout: EpisodeReadingLayoutOverrides;
      /**
       * Where the episode states it may be bought, empty while it follows its
       * series. The form offers following the series as a choice, so it needs
       * this apart from the resolved value.
       */
      purchaseAvailability: PurchaseAvailabilityOverride;
      /**
       * Every translation of the episode, oldest first. `episode.title` is
       * that of the one in the tenant's default language, else the oldest.
       */
      translations: EpisodeTranslationItem[];
    }
  | { notFound: true; ok: false }
  | { message: string; notFound?: false; ok: false };

export type UpdateEpisodePublishScheduleResult =
  | { ok: true; episode: EpisodeItem }
  | { ok: false; message: string };

export type UpdateEpisodeAvailabilityResult =
  | { ok: true; availability: EpisodeAvailabilityOverride }
  | { ok: false; message: string };

export type UpdateEpisodePurchaseAvailabilityResult =
  | { ok: true; purchaseAvailability: PurchaseAvailabilityOverride }
  | { ok: false; message: string };

export type UpdateEpisodeLayoutResult =
  | { ok: true; layout: EpisodeReadingLayoutOverrides }
  | { ok: false; message: string };

export type UploadEpisodePagesResult =
  | { ok: true; uploadedCount: number }
  | { ok: false; message: string };

export type ListEpisodeImagesResult =
  | { ok: true; images: EpisodeImageItem[] }
  | {
      ok: false;
      message: string;
      images: EpisodeImageItem[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type ReorderEpisodesResult =
  | { ok: true; episodes: EpisodeItem[] }
  | { ok: false; message: string };

export type ReorderEpisodeImagesResult =
  | { ok: true; images: EpisodeImageItem[] }
  | { ok: false; message: string };

export type DeleteEpisodeImageResult =
  | { ok: true; images: EpisodeImageItem[] }
  | { ok: false; message: string };

export type ReplaceEpisodeImageResult =
  | { ok: true; images: EpisodeImageItem[] }
  | { ok: false; message: string };

export type UpdateEpisodeTitleResult =
  | { ok: true; episode: EpisodeItem }
  | { ok: false; message: string };

export type DeleteEpisodeTranslationResult =
  | { ok: true }
  | { ok: false; message: string };

export type UpdateEpisodePricingResult =
  | { ok: true; episode: EpisodeItem }
  | { ok: false; message: string };

export type EpisodeEyeCatchResult =
  | { ok: true; episode: EpisodeItem }
  | { ok: false; message: string };

export type EpisodeEyeCatchAspectResult =
  | { ok: true; episode: EpisodeItem }
  /**
   * The API refused the image itself. It carries no message: the minimum to
   * name is the one of the ratio that was refused, and only the slot that
   * submitted knows which ratio that is and what size it asks for.
   */
  | { ok: false; imageRejected: true }
  | { ok: false; message: string };

export interface EpisodeCreditPair {
  creatorId: string;
  roleId: string;
}

export type BulkEpisodeCreditOperation =
  | { type: "add"; credit: EpisodeCreditPair }
  | { type: "replace"; from: EpisodeCreditPair; to: EpisodeCreditPair }
  | { type: "remove"; credit: EpisodeCreditPair }
  | { type: "set_share"; credit: EpisodeCreditPair; shareBps: number };

export type EpisodeCreditUnchangedReasonValue =
  | "already_credited"
  | "not_credited"
  | "credited_on_the_episode"
  | "unspecified";

export interface UnchangedEpisodeCreditItem {
  episodeId: string;
  reason: EpisodeCreditUnchangedReasonValue;
}

export type BulkEditEpisodeCreditsResult =
  | {
      ok: true;
      changedEpisodeIds: string[];
      unchangedEpisodes: UnchangedEpisodeCreditItem[];
    }
  | { ok: false; message: string };

export interface EpisodeCreatorCreditItem {
  creatorId: string;
  roleId: string;
  /** The share of this episode's sales the credit is paid, in basis points. */
  shareBps: number;
  source: CreatorCreditSource;
}

export type ListEpisodeCreditsResult =
  | { ok: true; credits: EpisodeCreatorCreditItem[] }
  | { ok: false; message: string };

export type ReplaceEpisodeCreditsResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Page size for the order-index scan a reorder needs. The RPC caps `limit` at
 * 100, so this is the fewest round trips a series can be read in.
 */
const reorderScanPageSize = 100;

const mapErrorToMessage = async (
  cause: unknown,
  fallbackMessage: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, fallbackMessage, {
    locale,
    overrides: {
      "invalid-argument": rpcErrorHasFieldViolation(cause, "locale")
        ? t("admin.series.episodes.translations.locale_not_offered")
        : undefined,
      "not-found": t("admin.series.episodes.series_not_found"),
    },
  });
};

/**
 * The failure of a write that carries a price: the one {@link mapErrorToMessage}
 * words, except a refusal of the currency the price was entered in, which the
 * API gives when the tenant's currency changed after the form read it.
 */
const mapPriceErrorToMessage = async (
  cause: unknown,
  fallbackMessage: string,
  locale: Locale
): Promise<string> => {
  if (rpcErrorHasFieldViolation(cause, "currency")) {
    const t = await getMessagesFor(locale);

    return t("admin.series.episodes.currency_changed");
  }

  return mapErrorToMessage(cause, fallbackMessage, locale);
};

const mapReorderErrorToMessage = async (
  cause: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, t("admin.series.episodes.reorder_failed"), {
    locale,
    overrides: {
      "not-found": t("admin.series.episodes.series_not_found"),
      precondition: t("admin.series.episodes.reorder_conflict"),
    },
  });
};

/** The generated `Episode` fields {@link mapEpisode} reads (see `series.ts`). */
type RawEpisode = Pick<
  Episode,
  | "availability"
  | "eyeCatchImageUpdatedAt"
  | "eyeCatchImageVariants"
  | "id"
  | "orderIndex"
  | "price"
  | "publicId"
  | "publishedAt"
  | "readingPeriodHours"
  | "rentalPeriodHours"
  | "rentalPrice"
  | "scheduledAt"
  | "status"
  | "title"
>;

/**
 * The tag `getEpisode()`, `listEpisodeCredits()`, and `listEpisodeImages()`
 * cache one episode under.
 * Every Action that changes what the edit screen shows of that episode clears
 * it, which carries the change back to the screen that submitted.
 */
export const episodeCacheTag = (tenantId: string, episodeId: string): string =>
  `episode-${tenantId}-${episodeId}`;

/**
 * The tag every shared episode read is filed under — the lists, one episode,
 * and its credits. Every Action that writes an episode clears it, so the
 * change reaches every operator's next read of any of them.
 */
export const episodesCacheTag = (tenantId: string): string =>
  `episodes-${tenantId}`;

/**
 * The tag `publira server` drops in every app when an episode changes without
 * an operator — a scheduled episode going live, a free window opening or
 * closing. The storefront's series pages carry it for the same reason, so
 * the console's episode reads carry it too rather than showing an episode as
 * scheduled after it went live.
 */
export const episodePublicationCacheTag = (tenantId: string): string =>
  `tenant:${tenantId}:series:detail`;

const mapEpisode = (episode: RawEpisode): EpisodeItem => ({
  // A value naming none of the three is reported by the reads that open a
  // form on it; a list only loses the mark on that row.
  availability: toSurfaceAvailabilityValue(episode.availability) ?? "",
  eyeCatchImageUpdatedAt: episode.eyeCatchImageUpdatedAt ?? "",
  eyeCatchImageVariants: (episode.eyeCatchImageVariants ?? []).flatMap(
    (variant) => {
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
    }
  ),
  id: episode.id,
  orderIndex: episode.orderIndex,
  price: episode.price,
  publicId: episode.publicId,
  publishedAt: episode.publishedAt,
  readingPeriodHours: episode.readingPeriodHours ?? 0,
  rentalPeriodHours: episode.rentalPeriodHours ?? 0,
  rentalPrice: episode.rentalPrice ?? 0,
  scheduledAt: episode.scheduledAt,
  status: episode.status,
  title: episode.title,
});

/**
 * A direction naming neither value is reported rather than read as following
 * the series: the form would open on that choice, and the next save would
 * write it over the direction the episode holds.
 */
const toEpisodeLayoutOverrides = (
  response: Pick<
    GetEpisodeResponse | UpdateEpisodeLayoutResponse,
    "readingDirection" | "spreadStartIndex"
  >
): EpisodeReadingLayoutOverrides | undefined => {
  const readingDirection = toReadingDirectionValue(response.readingDirection);

  if (readingDirection === undefined) {
    return;
  }

  return {
    readingDirection,
    spreadStartIndex: response.spreadStartIndex,
  };
};

/** The generated `EpisodeImage` fields {@link mapEpisodeImage} reads (see `series.ts`). */
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

const mapEpisodeImage = (image: RawEpisodeImage): EpisodeImageItem => ({
  contentType: image.contentType,
  displayOrder: image.displayOrder,
  fileSizeBytes: image.fileSizeBytes.toString(),
  height: image.height,
  id: image.id,
  imageUrl: image.imageUrl,
  width: image.width,
});

type EpisodeCreditShareRecord = Pick<
  EpisodeCreatorCreditItem,
  "creatorId" | "roleId" | "shareBps"
>;

/**
 * The records name each credit by the IDs the form picks from, and a `Creator`
 * by public IDs only, so it lends nothing but `source`. The server fills both
 * lists from the same rows in the same order, which is what pairs them.
 */
const mapEpisodeCredits = (
  creators: readonly Pick<Creator, "source">[],
  records: readonly EpisodeCreditShareRecord[]
): EpisodeCreatorCreditItem[] =>
  records.map((record, index) => ({
    creatorId: record.creatorId,
    roleId: record.roleId,
    shareBps: record.shareBps,
    source: creators[index]?.source ?? CreatorCreditSource.UNSPECIFIED,
  }));

const listEpisodeCreditsForTenant = async (
  input: { tenantId: string; episodeId: string },
  locale: Locale
): Promise<ListEpisodeCreditsResult> => {
  "use cache";
  cacheTag(episodesCacheTag(input.tenantId));
  cacheTag(episodeCacheTag(input.tenantId, input.episodeId));

  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.series.listEpisodeCredits(
      {
        episodeId: input.episodeId,
        tenant: { tenantId: input.tenantId },
      },
      withServiceHeaders()
    );

    return {
      credits: mapEpisodeCredits(
        response.creators ?? [],
        response.creatorCredits ?? []
      ),
      ok: true,
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.credits_list_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * The credits one episode carries, read with the service credential: the same
 * for every operator of the tenant, so one entry serves all of them.
 */
export const listEpisodeCredits = async (input: {
  episodeId: string;
}): Promise<ListEpisodeCreditsResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();

  return listEpisodeCreditsForTenant({ ...input, tenantId }, locale);
};

export const replaceEpisodeCredits = async (
  input: {
    tenantId: string;
    episodeId: string;
    creatorCredits: EpisodeCreditShareRecord[];
  },
  locale: Locale
): Promise<ReplaceEpisodeCreditsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.series.replaceEpisodeCredits(
      {
        creatorCredits: input.creatorCredits,
        episodeId: input.episodeId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.credits_save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Every archive rejection is `invalid_argument`, so the code alone cannot say
 * whether the ePub is unreadable, its spine is inconsistent, or an entry path
 * escapes the archive — and an uploader needs to know which. The server sends
 * those cases as stable `google.rpc.ErrorInfo` reasons.
 */
const archiveRejectionMessage = async (
  cause: unknown,
  locale: Locale
): Promise<string | undefined> => {
  const t = await getMessagesFor(locale);

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.archiveInvalidEPUB)) {
    return t("admin.series.episodes.epub_invalid");
  }

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.archiveInvalidEPUBSpine)) {
    return t("admin.series.episodes.epub_spine_invalid");
  }

  return rpcErrorHasReason(cause, RPC_ERROR_REASON.archiveInvalidPath)
    ? t("admin.series.episodes.archive_path_invalid")
    : undefined;
};

const mapEpisodeUploadErrorMessage = async (
  cause: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, t("admin.series.episodes.upload_failed"), {
    locale,
    overrides: {
      "invalid-argument":
        (await archiveRejectionMessage(cause, locale)) ??
        t("errors.rpc.invalid-argument"),
      precondition: mentionsStorageNotConfigured(cause)
        ? t("admin.errors.storage_not_configured")
        : undefined,
    },
  });
};

const uploadArchive = async (input: {
  archive: File;
  episodeId: string;
  seriesId?: string;
  tenantId: string;
  sessionId: string;
}) => {
  const request: Parameters<typeof apiClient.series.uploadEpisodeImages>[0] = {
    archiveContentType: input.archive.type || "application/octet-stream",
    archiveData: new Uint8Array(await input.archive.arrayBuffer()),
    archiveFilename: input.archive.name,
    episodeId: input.episodeId,
    seriesId: input.seriesId ?? "",
    tenant: { tenantId: input.tenantId },
  };

  return apiClient.series.uploadEpisodeImages(
    request,
    withSessionHeaders(input.sessionId)
  );
};

const uploadPages = async (input: {
  pages: File[];
  episodeId: string;
  tenantId: string;
  sessionId: string;
}) =>
  apiClient.series.uploadEpisodeImages(
    {
      episodeId: input.episodeId,
      images: await Promise.all(
        input.pages.map(async (page, index) => ({
          contentType: page.type || "application/octet-stream",
          data: new Uint8Array(await page.arrayBuffer()),
          displayOrder: index,
          filename: page.name,
        }))
      ),
      tenant: { tenantId: input.tenantId },
    },
    withSessionHeaders(input.sessionId)
  );

export const createEpisode = async (
  input: {
    tenantId: string;
    seriesId: string;
    title: string;
    price: number;
    /** The currency the price was entered in, which the API checks it against. */
    currency: string;
    readingPeriodHours: number;
    /** Both 0 create an episode that is not rented. */
    rentalPrice: number;
    rentalPeriodHours: number;
    publishAt: string;
    availability: EpisodeAvailabilityOverride;
    /** The empty value follows the series. */
    purchaseAvailability: PurchaseAvailabilityOverride;
  },
  locale: Locale
): Promise<CreateEpisodeResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.createEpisode(
      {
        availability: input.availability
          ? SURFACE_AVAILABILITY_ENUM[input.availability]
          : undefined,
        currency: input.currency,
        // Omitting orderIndex makes the server append to the end.
        price: input.price,
        purchaseAvailability: toSurfaceAvailabilityOverrideEnum(
          input.purchaseAvailability
        ),
        readingPeriodHours: input.readingPeriodHours,
        rentalPeriodHours: input.rentalPeriodHours,
        rentalPrice: input.rentalPrice,
        scheduledAt: input.publishAt,
        seriesId: input.seriesId,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.episode?.publicId?.trim()) {
      return {
        message: t("admin.series.episodes.create_failed"),
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapPriceErrorToMessage(
        error,
        t("admin.series.episodes.create_failed"),
        locale
      ),
      ok: false,
    };
  }
};

const listEpisodesForTenant = async (
  input: {
    tenantId: string;
    seriesId: string;
  } & CursorPageOptions,
  locale: Locale
): Promise<ListEpisodesResult> => {
  "use cache";
  cacheTag(episodesCacheTag(input.tenantId));
  cacheTag(episodePublicationCacheTag(input.tenantId));

  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.series.listEpisodes(
      {
        ...cursorPageRequest(input),
        seriesId: input.seriesId,
        tenant: { tenantId: input.tenantId },
      },
      withServiceHeaders()
    );

    return {
      ...cursorPageTokens(response),
      episodes: (response.episodes ?? []).map((episode) => mapEpisode(episode)),
      ok: true,
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.list_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * One page of a series' episodes, in the order the series displays them.
 *
 * The rows keep the server's keyset order (`order_index`, `id` ascending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the series spans more than one page.
 *
 * Read with the service credential: the page is the same for every operator of
 * the tenant, so one entry serves all of them.
 */
export const listEpisodes = async (
  input: { seriesId: string } & CursorPageOptions
): Promise<ListEpisodesResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();

  return listEpisodesForTenant({ ...input, tenantId }, locale);
};

/**
 * The cached body of {@link listAllEpisodes}, keyed on the tenant and locale it is given.
 *
 * Exported for a Server Action, which cannot read the `[tenant_id]` segment
 * and is given the tenant by the client: it calls `verifyAdminSession` with
 * that tenant first, because the service credential this reads with answers
 * for any tenant.
 */
export const listAllEpisodesForTenant = async (
  input: {
    seriesId: string;
    tenantId: string;
  },
  locale: Locale
): Promise<ListEpisodesResult> => {
  "use cache";
  cacheTag(episodesCacheTag(input.tenantId));
  cacheTag(episodePublicationCacheTag(input.tenantId));

  const t = await getMessagesFor(locale);

  try {
    const episodes: EpisodeItem[] = [];

    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.series.listEpisodes(
          {
            limit,
            seriesId: input.seriesId,
            tenant: { tenantId: input.tenantId },
            token,
          },
          withServiceHeaders()
        );

        return {
          items: response.episodes ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          episodes.push(mapEpisode(item));
        }
      }
    );

    if (walkStop !== "completed") {
      dropFailedCacheEntry();

      return {
        ...emptyCursorPageTokens,
        episodes: [],
        message: t("admin.series.episodes.list_failed"),
        ok: false,
      };
    }

    return {
      ...emptyCursorPageTokens,
      episodes,
      ok: true,
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();

    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.list_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Every episode in a series for combobox pickers (access-ticket form).
 *
 * Walks `ListEpisodes` cursor pages so the picker can search beyond a single
 * RPC page. The series episode list keeps {@link listEpisodes} (one page) so
 * list paging stays independent of picker loading.
 *
 * Rows stay in the server's display order (`order_index`). An incomplete walk
 * fails with an empty list rather than a partial option set that would hide
 * later episodes.
 */
export const listAllEpisodes = async (input: {
  seriesId: string;
}): Promise<ListEpisodesResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();

  return listAllEpisodesForTenant({ ...input, tenantId }, locale);
};

/**
 * The cached body of {@link getEpisode}, keyed on the tenant and locale it is given.
 *
 * Exported for a Server Action, which cannot read the `[tenant_id]` segment
 * and is given the tenant by the client: it calls `verifyAdminSession` with
 * that tenant first, because the service credential this reads with answers
 * for any tenant.
 */
export const getEpisodeForTenant = async (
  input: {
    tenantId: string;
    seriesPublicId: string;
    publicId: string;
  },
  locale: Locale
): Promise<GetEpisodeResult> => {
  "use cache";
  cacheTag(episodesCacheTag(input.tenantId));
  cacheTag(episodePublicationCacheTag(input.tenantId));

  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.series.getEpisode(
      {
        publicId: input.publicId,
        seriesPublicId: input.seriesPublicId,
        tenant: { tenantId: input.tenantId },
      },
      withServiceHeaders()
    );

    const layout = toEpisodeLayoutOverrides(response);

    const purchaseAvailability = toSurfaceAvailabilityValue(
      response.purchaseAvailability
    );

    // An unknown availability would open the form on following the series,
    // and the next save would write that over the episode's own value.
    if (
      !response.episode?.publicId?.trim() ||
      layout === undefined ||
      purchaseAvailability === undefined ||
      toSurfaceAvailabilityValue(response.episode.availability) === undefined
    ) {
      dropFailedCacheEntry();

      return {
        message: t("admin.series.episodes.get_failed"),
        ok: false,
      };
    }

    cacheTag(episodeCacheTag(input.tenantId, response.episode.id));

    return {
      episode: mapEpisode(response.episode),
      layout,
      ok: true,
      purchaseAvailability,
      translations: toEpisodeTranslations(response.translations),
    };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }

    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.get_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const getEpisode = async (input: {
  seriesPublicId: string;
  publicId: string;
}): Promise<GetEpisodeResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();

  return getEpisodeForTenant({ ...input, tenantId }, locale);
};

export const updateEpisodePublishSchedule = async (
  input: {
    tenantId: string;
    episodeId: string;
    publishAt: string;
  },
  locale: Locale
): Promise<UpdateEpisodePublishScheduleResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateEpisodePublishSchedule(
      {
        episodeId: input.episodeId,
        scheduledAt: input.publishAt,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.episode?.publicId?.trim()) {
      return {
        message: t("admin.series.episodes.schedule_failed"),
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.schedule_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/** The empty value puts the episode back on following its series. */
export const updateEpisodeAvailability = async (
  input: {
    tenantId: string;
    episodeId: string;
    availability: EpisodeAvailabilityOverride;
  },
  locale: Locale
): Promise<UpdateEpisodeAvailabilityResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateEpisodeAvailability(
      {
        availability: input.availability
          ? SURFACE_AVAILABILITY_ENUM[input.availability]
          : undefined,
        episodeId: input.episodeId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    const availability = toSurfaceAvailabilityValue(
      response.episode?.availability
    );

    if (availability === undefined) {
      return {
        message: t("admin.series.episodes.availability.failed"),
        ok: false,
      };
    }

    return { availability, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.availability.failed"),
        locale
      ),
      ok: false,
    };
  }
};

/** The empty value puts the episode back on following its series. */
export const updateEpisodePurchaseAvailability = async (
  input: {
    tenantId: string;
    episodeId: string;
    purchaseAvailability: PurchaseAvailabilityOverride;
  },
  locale: Locale
): Promise<UpdateEpisodePurchaseAvailabilityResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateEpisodePurchaseAvailability(
      {
        episodeId: input.episodeId,
        purchaseAvailability: toSurfaceAvailabilityOverrideEnum(
          input.purchaseAvailability
        ),
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    const purchaseAvailability = toSurfaceAvailabilityValue(
      response.purchaseAvailability
    );

    if (purchaseAvailability === undefined) {
      return {
        message: t("admin.series.episodes.purchase_availability.failed"),
        ok: false,
      };
    }

    return { ok: true, purchaseAvailability };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.purchase_availability.failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Writes both overrides on every call, so the empty direction and an absent
 * index put that value back on following the series.
 */
export const updateEpisodeLayout = async (
  input: {
    tenantId: string;
    episodeId: string;
  } & EpisodeReadingLayoutOverrides,
  locale: Locale
): Promise<UpdateEpisodeLayoutResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateEpisodeLayout(
      {
        episodeId: input.episodeId,
        readingDirection: input.readingDirection
          ? READING_DIRECTION_ENUM[input.readingDirection]
          : undefined,
        spreadStartIndex: input.spreadStartIndex,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    const layout = toEpisodeLayoutOverrides(response);

    if (layout === undefined) {
      return {
        message: t("admin.series.episodes.layout.failed"),
        ok: false,
      };
    }

    return { layout, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.layout.failed"),
        {
          locale,
          overrides: {
            // Only the server counts the pages, so it is what refuses a page
            // past the last one when the form had no count to limit it by.
            "invalid-argument": rpcErrorHasFieldViolation(
              error,
              "spread_start_index"
            )
              ? t(
                  "admin.series.episodes.validation.spread_start_past_last_page"
                )
              : t("errors.rpc.invalid-argument"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const uploadEpisodePages = async (
  input: {
    tenantId: string;
    episodeId: string;
    seriesId?: string;
    pages?: File[];
    archive?: File;
  },
  locale: Locale
): Promise<UploadEpisodePagesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (!input.archive && (!input.pages || input.pages.length === 0)) {
    return {
      message: t("admin.series.episodes.validation.pages_required"),
      ok: false,
    };
  }

  try {
    const response = input.archive
      ? await uploadArchive({
          archive: input.archive,
          episodeId: input.episodeId,
          seriesId: input.seriesId,
          sessionId,
          tenantId: input.tenantId,
        })
      : await uploadPages({
          episodeId: input.episodeId,
          pages: input.pages ?? [],
          sessionId,
          tenantId: input.tenantId,
        });

    return {
      ok: true,
      uploadedCount: response.images.length,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapEpisodeUploadErrorMessage(error, locale),
      ok: false,
    };
  }
};

const listEpisodeImagesForSession = async (
  input: {
    tenantId: string;
    episodeId: string;
  },
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListEpisodeImagesResult>> => {
  "use cache: private";
  cacheTag(episodeCacheTag(input.tenantId, input.episodeId));

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      images: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.series.listEpisodeImages(
      {
        episodeId: input.episodeId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      images: (response.images ?? []).map((image) => mapEpisodeImage(image)),
      ok: true,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      images: [],
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.image_list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const listEpisodeImages = async (
  input: {
    tenantId: string;
    episodeId: string;
  },
  locale: Locale
): Promise<ListEpisodeImagesResult> =>
  settleCachedRead(
    await listEpisodeImagesForSession(input, locale, await getAccessToken())
  );

/**
 * The current image URL of each of an episode's pages, by image id, read
 * uncached: the admin media token a URL carries expires a while after it was
 * issued, and a cached answer would hand back the one that already has.
 * `undefined` when the pages could not be read.
 */
export const renewEpisodeImageUrls = async (input: {
  tenantId: string;
  episodeId: string;
}): Promise<Record<string, string> | undefined> => {
  const sessionId = await getAccessToken();

  if (!sessionId) {
    return;
  }

  try {
    const response = await apiClient.series.listEpisodeImages(
      {
        episodeId: input.episodeId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return Object.fromEntries(
      (response.images ?? []).map((image) => [image.id, image.imageUrl])
    );
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
  }
};

const reorderEpisodes = async (
  input: {
    tenantId: string;
    seriesId: string;
    episodeIds: string[];
    expectedEpisodeIds: string[];
  },
  locale: Locale
): Promise<ReorderEpisodesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (input.episodeIds.length === 0) {
    return {
      message: t("admin.series.episodes.validation.no_episodes_to_sort"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.reorderEpisodes(
      {
        episodeIds: input.episodeIds,
        expectedEpisodeIds: input.expectedEpisodeIds,
        seriesId: input.seriesId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      episodes: (response.episodes ?? []).map((episode) => mapEpisode(episode)),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapReorderErrorToMessage(error, locale),
      ok: false,
    };
  }
};

/**
 * Slot the new order of one page back into the series' current order.
 *
 * A drag only ever permutes the rows of the page it happened on, so every other
 * episode keeps its position and the page's rows are refilled, in their new
 * order, into the slots that page already occupied.
 *
 * `currentPageIds` is the order the page was showing when the drag
 * started, and it is checked against the series before anything is written: the
 * page's rows must still sit in one unbroken run of slots, in exactly that
 * order. Comparing ids alone is not enough. If someone else moves an episode
 * into the middle of the page — `[C, D]` on screen while the series becomes
 * `[C, A, B, D]` — the ids all still exist, and dropping `[D, C]` into the two
 * slots those ids now occupy would write `[D, A, B, C]`, moving rows the user
 * never touched.
 *
 * Returns `null` whenever the page no longer lines up with the series that way,
 * including a duplicate id or an id the series does not have because it was
 * created or deleted while the page was on screen. The order is then left alone
 * and the screen reloads instead of writing a guess.
 *
 * The check is against the order this request read back, so it closes the
 * window the page was on screen for. The remaining window — between that
 * read and the write — is closed by sending the read order as
 * `expectedEpisodeIds`. The server locks the series, compares, and
 * rejects the write when it no longer matches.
 */
export const mergeEpisodeOrder = (
  seriesEpisodeIds: readonly string[],
  currentPageIds: readonly string[],
  nextPageIds: readonly string[]
): string[] | null => {
  if (
    nextPageIds.length === 0 ||
    currentPageIds.length !== nextPageIds.length
  ) {
    return null;
  }

  const pageIdSet = new Set(nextPageIds);

  if (pageIdSet.size !== nextPageIds.length) {
    return null;
  }

  const slots: number[] = [];

  for (const [index, id] of seriesEpisodeIds.entries()) {
    if (pageIdSet.has(id)) {
      slots.push(index);
    }
  }

  if (slots.length !== nextPageIds.length) {
    return null;
  }

  // One unbroken run of slots, holding exactly the order the page was showing.
  const [firstSlot = 0] = slots;
  const lastSlot = slots.at(-1) ?? 0;

  if (lastSlot - firstSlot !== slots.length - 1) {
    return null;
  }

  if (
    slots.some(
      (slot, index) => seriesEpisodeIds[slot] !== currentPageIds[index]
    )
  ) {
    return null;
  }

  const merged = [...seriesEpisodeIds];

  for (const [index, slot] of slots.entries()) {
    merged[slot] = nextPageIds[index];
  }

  return merged;
};

const listSeriesEpisodeIds = async (input: {
  sessionId: string;
  tenantId: string;
  seriesId: string;
}): Promise<string[] | null> => {
  const ids: string[] = [];

  const stop = await forEachPageWithToken<string>(
    async (token, limit) => {
      const response = await apiClient.series.listEpisodes(
        {
          limit,
          seriesId: input.seriesId,
          tenant: { tenantId: input.tenantId },
          token,
        },
        withSessionHeaders(input.sessionId)
      );

      return {
        items: (response.episodes ?? []).map((episode) => episode.id),
        nextToken: response.nextToken ?? "",
      };
    },
    (items) => {
      ids.push(...items);
    },
    { pageSize: reorderScanPageSize }
  );

  // A walk that stopped on a bound saw only part of the series, and a partial
  // order would move every episode it never read. Better to give up.
  return stop === "completed" ? ids : null;
};

/**
 * Apply the new order of one episode list page.
 *
 * `ReorderEpisodes` takes the whole series in one request — it renumbers
 * `order_index` from the list it is given and rejects anything shorter — but a
 * paginated screen only holds one page of it. So the series' current order is
 * read back here and the page is merged into it before the RPC is called.
 *
 * `currentEpisodeIds` is the page's order as the screen was showing it,
 * and the merge writes nothing unless the series still agrees with it — see
 * `mergeEpisodeOrder`.
 */
export const reorderEpisodePage = async (
  input: {
    tenantId: string;
    seriesId: string;
    currentEpisodeIds: string[];
    episodeIds: string[];
  },
  locale: Locale
): Promise<ReorderEpisodesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (input.episodeIds.length === 0) {
    return {
      message: t("admin.series.episodes.validation.no_episodes_to_sort"),
      ok: false,
    };
  }

  let seriesEpisodeIds: string[] | null;

  try {
    seriesEpisodeIds = await listSeriesEpisodeIds({
      seriesId: input.seriesId,
      sessionId,
      tenantId: input.tenantId,
    });
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.reorder_failed"),
        locale
      ),
      ok: false,
    };
  }

  if (!seriesEpisodeIds) {
    return {
      message: t("admin.series.episodes.reorder_too_many"),
      ok: false,
    };
  }

  const episodeIds = mergeEpisodeOrder(
    seriesEpisodeIds,
    input.currentEpisodeIds,
    input.episodeIds
  );

  if (!episodeIds) {
    return {
      message: t("admin.series.episodes.reorder_conflict"),
      ok: false,
    };
  }

  return await reorderEpisodes(
    {
      episodeIds,
      expectedEpisodeIds: seriesEpisodeIds,
      seriesId: input.seriesId,
      tenantId: input.tenantId,
    },
    locale
  );
};

export const reorderEpisodeImages = async (
  input: {
    tenantId: string;
    episodeId: string;
    imageIds: string[];
  },
  locale: Locale
): Promise<ReorderEpisodeImagesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (input.imageIds.length === 0) {
    return {
      message: t("admin.series.episodes.validation.no_images_to_sort"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.reorderEpisodeImages(
      {
        episodeId: input.episodeId,
        imageIds: input.imageIds,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      images: (response.images ?? []).map((image) => mapEpisodeImage(image)),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.image_reorder_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * A page that is not the episode's, or no longer is, is `not_found`: someone
 * else deleted or replaced it since the screen was drawn.
 */
const mapEpisodeImageErrorToMessage = async (
  cause: unknown,
  fallbackMessage: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, fallbackMessage, {
    locale,
    overrides: {
      "not-found": t("admin.series.episodes.page_not_found"),
    },
  });
};

/** Takes one page out of the episode; the pages after it move up one place. */
export const deleteEpisodeImage = async (
  input: {
    tenantId: string;
    episodeId: string;
    imageId: string;
  },
  locale: Locale
): Promise<DeleteEpisodeImageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.deleteEpisodeImage(
      {
        episodeId: input.episodeId,
        imageId: input.imageId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      images: (response.images ?? []).map((image) => mapEpisodeImage(image)),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapEpisodeImageErrorToMessage(
        error,
        t("admin.series.episodes.image_delete.failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Puts `image` in the place of one page, leaving every other page where it
 * was. The new page gets an id of its own, so the screen reads the list again
 * rather than keeping the old one's.
 */
export const replaceEpisodeImage = async (
  input: {
    tenantId: string;
    episodeId: string;
    imageId: string;
    image: File;
  },
  locale: Locale
): Promise<ReplaceEpisodeImageResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.replaceEpisodeImage(
      {
        contentType: input.image.type || "application/octet-stream",
        data: new Uint8Array(await input.image.arrayBuffer()),
        episodeId: input.episodeId,
        filename: input.image.name,
        imageId: input.imageId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      images: (response.images ?? []).map((image) => mapEpisodeImage(image)),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.image_replace.failed"),
        {
          locale,
          overrides: {
            // The ids come from the screen, so what the server refuses is
            // the image: one it cannot decode, or one over its size.
            "invalid-argument": t(
              "admin.series.episodes.image_replace.invalid"
            ),
            "not-found": t("admin.series.episodes.page_not_found"),
            precondition: mentionsStorageNotConfigured(error)
              ? t("admin.errors.storage_not_configured")
              : undefined,
          },
        }
      ),
      ok: false,
    };
  }
};

/**
 * Renames the episode in one language, adding its translation in that
 * language when it has none. The title is sent as the caller hands it over,
 * already trimmed: the API stores what it is given.
 */
export const updateEpisodeTitle = async (
  input: {
    tenantId: string;
    episodeId: string;
    title: string;
    /** Absent writes the tenant's default language. */
    translationLocale?: Locale;
  },
  locale: Locale
): Promise<UpdateEpisodeTitleResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateEpisodeTitle(
      {
        episodeId: input.episodeId,
        locale: input.translationLocale,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.episode?.publicId?.trim()) {
      return {
        message: t("admin.series.episodes.rename.failed"),
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.rename.failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Deletes the episode's title in one language. The API keeps an episode's last
 * translation, and refuses to delete it.
 */
export const deleteEpisodeTranslation = async (
  input: {
    tenantId: string;
    episodeId: string;
    translationLocale: Locale;
  },
  locale: Locale
): Promise<DeleteEpisodeTranslationResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    await apiClient.series.deleteEpisodeTranslation(
      {
        episodeId: input.episodeId,
        locale: input.translationLocale,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.translations.delete_failed"),
        {
          locale,
          overrides: {
            "not-found": t("admin.series.episodes.translations.not_found"),
            precondition: t(
              "admin.series.episodes.translations.last_translation"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

/**
 * Sets the episode's price and reading period, and its rental, all on every
 * call. None reaches back: a purchase already made keeps the price it was paid
 * and the expiry it was given.
 */
export const updateEpisodePricing = async (
  input: {
    tenantId: string;
    episodeId: string;
    price: number;
    /** The currency the price was entered in, which the API checks it against. */
    currency: string;
    readingPeriodHours: number;
    /** Both 0 stop renting the episode. */
    rentalPrice: number;
    rentalPeriodHours: number;
  },
  locale: Locale
): Promise<UpdateEpisodePricingResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateEpisodePricing(
      {
        currency: input.currency,
        episodeId: input.episodeId,
        price: input.price,
        readingPeriodHours: input.readingPeriodHours,
        rentalPeriodHours: input.rentalPeriodHours,
        rentalPrice: input.rentalPrice,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.episode?.publicId?.trim()) {
      return {
        message: t("admin.series.episodes.pricing.failed"),
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapPriceErrorToMessage(
        error,
        t("admin.series.episodes.pricing.failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * The failure of a write on the episode's eye-catch. An image the API refused
 * is named apart from the rest, since replacing the image is what clears it,
 * and so is an upload no object store has been set up to take.
 */
const mapEyeCatchErrorToMessage = async (
  cause: unknown,
  locale: Locale,
  /** What any other failed precondition means for this write. */
  preconditionMessage?: string
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(cause, t("admin.series.episodes.eye_catch.failed"), {
    locale,
    overrides: {
      "invalid-argument": mentionsAspectImageRejection(cause)
        ? t("admin.series.episodes.eye_catch.image_invalid")
        : undefined,
      "not-found": t("admin.series.episodes.validation.episode_missing"),
      precondition: mentionsStorageNotConfigured(cause)
        ? t("admin.errors.storage_not_configured")
        : preconditionMessage,
    },
  });
};

/**
 * Gives the episode an eye-catch of its own from one image, which the API cuts
 * into every ratio from its centre.
 */
export const uploadEpisodeEyeCatchImage = async (
  input: {
    tenantId: string;
    episodeId: string;
    imageContentType?: string;
    imageData: Uint8Array;
  },
  locale: Locale
): Promise<EpisodeEyeCatchResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.uploadEpisodeEyeCatchImage(
      {
        episodeId: input.episodeId,
        imageContentType: input.imageContentType,
        imageData: input.imageData,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.episode?.publicId?.trim()) {
      return {
        message: t("admin.series.episodes.eye_catch.failed"),
        ok: false,
      };
    }

    return { episode: mapEpisode(response.episode), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapEyeCatchErrorToMessage(error, locale),
      ok: false,
    };
  }
};

/**
 * Replaces the image of one aspect ratio of the episode's eye-catch. The other
 * ratios keep the images they already hold, so the eye-catch has to exist
 * first.
 */
export const uploadEpisodeEyeCatchAspectImage = async (
  input: {
    tenantId: string;
    episodeId: string;
    variantType: string;
    imageContentType?: string;
    imageData: Uint8Array;
    /** Where in the upload the cut is taken; omitted, the API centres it. */
    crop?: CropRect;
  },
  locale: Locale
): Promise<EpisodeEyeCatchAspectResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.uploadEpisodeEyeCatchAspectImage(
      {
        crop: input.crop,
        episodeId: input.episodeId,
        imageContentType: input.imageContentType,
        imageData: input.imageData,
        tenant: { tenantId: input.tenantId },
        variantType: input.variantType,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.episode?.publicId?.trim()) {
      return {
        message: t("admin.series.episodes.eye_catch.failed"),
        ok: false,
      };
    }

    return { episode: mapEpisode(response.episode), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    if (mentionsAspectImageRejection(error)) {
      return { imageRejected: true, ok: false };
    }

    return {
      // An episode with no eye-catch yet has no ratio to replace.
      message: await mapEyeCatchErrorToMessage(
        error,
        locale,
        t("admin.eye_catch.aspect.eye_catch_required")
      ),
      ok: false,
    };
  }
};

/**
 * Takes the episode's eye-catch away, so its series' is shown in its place.
 */
export const deleteEpisodeEyeCatchImage = async (
  input: { tenantId: string; episodeId: string },
  locale: Locale
): Promise<EpisodeEyeCatchResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.deleteEpisodeEyeCatchImage(
      {
        episodeId: input.episodeId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.episode?.publicId?.trim()) {
      return {
        message: t("admin.series.episodes.eye_catch.failed"),
        ok: false,
      };
    }

    return { episode: mapEpisode(response.episode), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapEyeCatchErrorToMessage(error, locale),
      ok: false,
    };
  }
};

const toUnchangedReason = (
  reason: EpisodeCreditUnchangedReason
): EpisodeCreditUnchangedReasonValue => {
  if (reason === EpisodeCreditUnchangedReason.ALREADY_CREDITED) {
    return "already_credited";
  }

  if (reason === EpisodeCreditUnchangedReason.NOT_CREDITED) {
    return "not_credited";
  }

  if (reason === EpisodeCreditUnchangedReason.CREDITED_ON_THE_EPISODE) {
    return "credited_on_the_episode";
  }

  return "unspecified";
};

const toBulkCreditOperation = (operation: BulkEpisodeCreditOperation) => {
  if (operation.type === "add") {
    return { case: "add" as const, value: { credit: operation.credit } };
  }

  if (operation.type === "replace") {
    return {
      case: "replace" as const,
      value: { from: operation.from, to: operation.to },
    };
  }

  if (operation.type === "set_share") {
    return {
      case: "setShare" as const,
      value: { credit: { ...operation.credit, shareBps: operation.shareBps } },
    };
  }

  return { case: "remove" as const, value: { credit: operation.credit } };
};

/**
 * A set-share refused as invalid is one that would take an episode of the
 * range over 100%, which the console can only find out from the server: the
 * other credits on those episodes are not on screen.
 */
const mapBulkCreditErrorToMessage = async (
  cause: unknown,
  operation: BulkEpisodeCreditOperation,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(
    cause,
    t("admin.series.episodes.credits.apply_failed"),
    {
      locale,
      overrides: {
        "invalid-argument":
          operation.type === "set_share"
            ? t("admin.series.episodes.credits.share_over_limit")
            : t("admin.series.episodes.credits.apply_failed"),
        "not-found": t("admin.series.episodes.series_not_found"),
        precondition: t("admin.series.episodes.credits.duplicate"),
      },
    }
  );
};

/**
 * One credit correction over a range of episodes. The range is the list of
 * public ids the console's picker composed; the RPC does not take a span of
 * order indexes, because a later reorder would make that span name a
 * different set than the picker showed.
 */
export const bulkEditEpisodeCredits = async (
  input: {
    tenantId: string;
    seriesId: string;
    episodeIds: string[];
    operation: BulkEpisodeCreditOperation;
  },
  locale: Locale
): Promise<BulkEditEpisodeCreditsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.bulkEditEpisodeCredits(
      {
        episodeIds: input.episodeIds,
        operation: toBulkCreditOperation(input.operation),
        seriesId: input.seriesId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      changedEpisodeIds: response.changedEpisodeIds ?? [],
      ok: true,
      unchangedEpisodes: (response.unchangedEpisodes ?? []).map((episode) => ({
        episodeId: episode.episodeId,
        reason: toUnchangedReason(episode.reason),
      })),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: await mapBulkCreditErrorToMessage(
        error,
        input.operation,
        locale
      ),
      ok: false,
    };
  }
};
