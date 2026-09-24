import { EpisodeCreditUnchangedReason } from "@publira/api-client/admin/series";
import type {
  GetEpisodeResponse,
  UpdateEpisodeLayoutResponse,
} from "@publira/api-client/admin/series";
import type {
  Creator,
  CreatorCreditSource,
  Episode,
  EpisodeImage,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  RPC_ERROR_REASON,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { mentionsStorageNotConfigured } from "./image-rejection";
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
  publicId: string;
  title: string;
  orderIndex: number;
  price: number;
  readingPeriodHours: number;
  status: string;
  scheduledAt: string;
  publishedAt: string;
  /**
   * Which surfaces the episode states of its own, empty where it follows its
   * series. It is the override rather than where the episode ends up, because
   * the series bounds it: see `episodeShownOn`.
   */
  availability: EpisodeAvailabilityOverride;
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
    | {
        ok: false;
        message: string;
        episodes: EpisodeItem[];
        /** The API rejected the session — the caller raises the login redirect. */
        requiresSignIn: boolean;
      }
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
    }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

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

export interface EpisodeCreditPair {
  creatorPublicId: string;
  rolePublicId: string;
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
  episodePublicId: string;
  reason: EpisodeCreditUnchangedReasonValue;
}

export type BulkEditEpisodeCreditsResult =
  | {
      ok: true;
      changedEpisodePublicIds: string[];
      unchangedEpisodes: UnchangedEpisodeCreditItem[];
    }
  | { ok: false; message: string };

export interface EpisodeCreatorCreditItem {
  creatorPublicId: string;
  rolePublicId: string;
  /** The share of this episode's sales the credit is paid, in basis points. */
  shareBps: number;
  source: CreatorCreditSource;
}

export type ListEpisodeCreditsResult =
  | { ok: true; credits: EpisodeCreatorCreditItem[] }
  | { ok: false; message: string; requiresSignIn: boolean };

export type ReplaceEpisodeCreditsResult =
  | { ok: true; credits: EpisodeCreatorCreditItem[] }
  | { ok: false; message: string };

/**
 * Page size for the order-index scan a reorder needs. The RPC caps `limit` at
 * 100, so this is the fewest round trips a series can be read in.
 */
const reorderScanPageSize = 100;

const mapErrorToMessage = async (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, fallbackMessage, {
    locale,
    overrides: {
      "not-found": t("admin.series.episodes.series_not_found"),
    },
  });
};

const mapReorderErrorToMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, t("admin.series.episodes.reorder_failed"), {
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
  | "orderIndex"
  | "price"
  | "publicId"
  | "publishedAt"
  | "readingPeriodHours"
  | "scheduledAt"
  | "status"
  | "title"
>;

/**
 * The tag `getEpisode()` and `listEpisodeImages()` cache one episode under.
 * Every Action that changes what the edit screen shows of that episode clears
 * it, which carries the change back to the screen that submitted.
 */
export const episodeCacheTag = (tenantId: string, publicId: string): string =>
  `episode-${tenantId}-${publicId}`;

const mapEpisode = (episode: RawEpisode): EpisodeItem => ({
  // A value naming none of the three is reported by the reads that open a
  // form on it; a list only loses the mark on that row.
  availability: toSurfaceAvailabilityValue(episode.availability) ?? "",
  orderIndex: episode.orderIndex,
  price: episode.price,
  publicId: episode.publicId,
  publishedAt: episode.publishedAt,
  readingPeriodHours: episode.readingPeriodHours ?? 0,
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

type RawEpisodeCredit = Pick<Creator, "publicId" | "role" | "source">;

type EpisodeCreditShareRecord = Pick<
  EpisodeCreatorCreditItem,
  "creatorPublicId" | "rolePublicId" | "shareBps"
>;

const creditKey = (creatorPublicId: string, rolePublicId: string): string =>
  `${creatorPublicId}\u0000${rolePublicId}`;

/**
 * `Creator` carries who and in what role, and the records carry the share:
 * the storefront reads `Creator` too, and a share is the publisher's business.
 */
const mapEpisodeCredits = (
  creators: readonly RawEpisodeCredit[],
  records: readonly EpisodeCreditShareRecord[]
): EpisodeCreatorCreditItem[] => {
  const shares = new Map(
    records.map((record) => [
      creditKey(record.creatorPublicId, record.rolePublicId),
      record.shareBps,
    ])
  );
  return creators.map((credit) => {
    const rolePublicId = credit.role?.publicId ?? "";
    return {
      creatorPublicId: credit.publicId,
      rolePublicId,
      shareBps: shares.get(creditKey(credit.publicId, rolePublicId)) ?? 0,
      source: credit.source,
    };
  });
};

export const listEpisodeCredits = async (
  input: { tenantId: string; episodePublicId: string },
  locale: Locale
): Promise<ListEpisodeCreditsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }
  try {
    const response = await apiClient.series.listEpisodeCredits(
      {
        episodePublicId: input.episodePublicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return {
      credits: mapEpisodeCredits(
        response.creators ?? [],
        response.creatorCredits ?? []
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.credits_list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const replaceEpisodeCredits = async (
  input: {
    tenantId: string;
    episodePublicId: string;
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
    const response = await apiClient.series.replaceEpisodeCredits(
      {
        creatorCredits: input.creatorCredits,
        episodePublicId: input.episodePublicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    // The response names the credits alone; their shares are the ones just
    // written.
    return {
      credits: mapEpisodeCredits(response.creators ?? [], input.creatorCredits),
      ok: true,
    };
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
  error: unknown,
  locale: Locale
): Promise<string | undefined> => {
  const t = await getMessagesFor(locale);
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.archiveInvalidEPUB)) {
    return t("admin.series.episodes.epub_invalid");
  }
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.archiveInvalidEPUBSpine)) {
    return t("admin.series.episodes.epub_spine_invalid");
  }
  return rpcErrorHasReason(error, RPC_ERROR_REASON.archiveInvalidPath)
    ? t("admin.series.episodes.archive_path_invalid")
    : undefined;
};

const mapEpisodeUploadErrorMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, t("admin.series.episodes.upload_failed"), {
    locale,
    overrides: {
      "invalid-argument":
        (await archiveRejectionMessage(error, locale)) ??
        t("errors.rpc.invalid-argument"),
      precondition: mentionsStorageNotConfigured(error)
        ? t("admin.errors.storage_not_configured")
        : undefined,
    },
  });
};

const uploadArchive = async (input: {
  archive: File;
  episodePublicId: string;
  seriesPublicId?: string;
  tenantId: string;
  sessionId: string;
}) => {
  const request = {
    archiveContentType: input.archive.type || "application/octet-stream",
    archiveData: new Uint8Array(await input.archive.arrayBuffer()),
    archiveFilename: input.archive.name,
    episodePublicId: input.episodePublicId,
    seriesPublicId: input.seriesPublicId ?? "",
    tenant: { tenantId: input.tenantId },
  } as Parameters<typeof apiClient.series.uploadEpisodeImages>[0];

  return apiClient.series.uploadEpisodeImages(
    request,
    withSessionHeaders(input.sessionId)
  );
};

const uploadPages = async (input: {
  pages: File[];
  episodePublicId: string;
  tenantId: string;
  sessionId: string;
}) =>
  apiClient.series.uploadEpisodeImages(
    {
      episodePublicId: input.episodePublicId,
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
    seriesPublicId: string;
    title: string;
    price: number;
    readingPeriodHours: number;
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
        // Omitting orderIndex makes the server append to the end.
        price: input.price,
        purchaseAvailability: toSurfaceAvailabilityOverrideEnum(
          input.purchaseAvailability
        ),
        readingPeriodHours: input.readingPeriodHours,
        scheduledAt: input.publishAt,
        seriesPublicId: input.seriesPublicId,
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
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.create_failed"),
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
 */
export const listEpisodes = async (
  input: {
    tenantId: string;
    seriesPublicId: string;
  } & CursorPageOptions,
  locale: Locale
): Promise<ListEpisodesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.series.listEpisodes(
      {
        ...cursorPageRequest(input),
        seriesPublicId: input.seriesPublicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      episodes: (response.episodes ?? []).map((episode) => mapEpisode(episode)),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
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
export const listAllEpisodes = async (
  input: {
    seriesPublicId: string;
    tenantId: string;
  },
  locale: Locale
): Promise<ListEpisodesResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const episodes: EpisodeItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.series.listEpisodes(
          {
            limit,
            seriesPublicId: input.seriesPublicId,
            tenant: { tenantId: input.tenantId },
            token,
          },
          withSessionHeaders(sessionId)
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
      return {
        ...emptyCursorPageTokens,
        episodes: [],
        message: t("admin.series.episodes.list_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return {
      ...emptyCursorPageTokens,
      episodes,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const getEpisode = async (
  input: {
    tenantId: string;
    seriesPublicId: string;
    publicId: string;
  },
  locale: Locale
): Promise<GetEpisodeResult> => {
  "use cache: private";
  cacheTag(episodeCacheTag(input.tenantId, input.publicId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.series.getEpisode(
      {
        publicId: input.publicId,
        seriesPublicId: input.seriesPublicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
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
      return {
        message: t("admin.series.episodes.get_failed"),
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      layout,
      ok: true,
      purchaseAvailability,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.get_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateEpisodePublishSchedule = async (
  input: {
    tenantId: string;
    episodePublicId: string;
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
        episodePublicId: input.episodePublicId,
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
    episodePublicId: string;
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
        episodePublicId: input.episodePublicId,
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
    episodePublicId: string;
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
        episodePublicId: input.episodePublicId,
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
    episodePublicId: string;
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
        episodePublicId: input.episodePublicId,
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
    episodePublicId: string;
    seriesPublicId?: string;
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
          episodePublicId: input.episodePublicId,
          seriesPublicId: input.seriesPublicId,
          sessionId,
          tenantId: input.tenantId,
        })
      : await uploadPages({
          episodePublicId: input.episodePublicId,
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

export const listEpisodeImages = async (
  input: {
    tenantId: string;
    episodePublicId: string;
  },
  locale: Locale
): Promise<ListEpisodeImagesResult> => {
  "use cache: private";
  cacheTag(episodeCacheTag(input.tenantId, input.episodePublicId));

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
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
        episodePublicId: input.episodePublicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      images: (response.images ?? []).map((image) => mapEpisodeImage(image)),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      images: [],
      message: await mapErrorToMessage(
        error,
        t("admin.series.episodes.image_list_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

const reorderEpisodes = async (
  input: {
    tenantId: string;
    seriesPublicId: string;
    episodePublicIds: string[];
    expectedEpisodePublicIds: string[];
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

  if (input.episodePublicIds.length === 0) {
    return {
      message: t("admin.series.episodes.validation.no_episodes_to_sort"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.reorderEpisodes(
      {
        episodePublicIds: input.episodePublicIds,
        expectedEpisodePublicIds: input.expectedEpisodePublicIds,
        seriesPublicId: input.seriesPublicId,
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
 * `currentPagePublicIds` is the order the page was showing when the drag
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
 * `expectedEpisodePublicIds`. The server locks the series, compares, and
 * rejects the write when it no longer matches.
 */
export const mergeEpisodeOrder = (
  seriesPublicIds: readonly string[],
  currentPagePublicIds: readonly string[],
  nextPagePublicIds: readonly string[]
): string[] | null => {
  if (
    nextPagePublicIds.length === 0 ||
    currentPagePublicIds.length !== nextPagePublicIds.length
  ) {
    return null;
  }

  const pagePublicIdSet = new Set(nextPagePublicIds);
  if (pagePublicIdSet.size !== nextPagePublicIds.length) {
    return null;
  }

  const slots: number[] = [];
  for (const [index, publicId] of seriesPublicIds.entries()) {
    if (pagePublicIdSet.has(publicId)) {
      slots.push(index);
    }
  }

  if (slots.length !== nextPagePublicIds.length) {
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
      (slot, index) => seriesPublicIds[slot] !== currentPagePublicIds[index]
    )
  ) {
    return null;
  }

  const merged = [...seriesPublicIds];
  for (const [index, slot] of slots.entries()) {
    merged[slot] = nextPagePublicIds[index];
  }

  return merged;
};

const listSeriesEpisodePublicIds = async (input: {
  sessionId: string;
  tenantId: string;
  seriesPublicId: string;
}): Promise<string[] | null> => {
  const publicIds: string[] = [];

  const stop = await forEachPageWithToken<string>(
    async (token, limit) => {
      const response = await apiClient.series.listEpisodes(
        {
          limit,
          seriesPublicId: input.seriesPublicId,
          tenant: { tenantId: input.tenantId },
          token,
        },
        withSessionHeaders(input.sessionId)
      );

      return {
        items: (response.episodes ?? []).map((episode) => episode.publicId),
        nextToken: response.nextToken ?? "",
      };
    },
    (items) => {
      publicIds.push(...items);
    },
    { pageSize: reorderScanPageSize }
  );

  // A walk that stopped on a bound saw only part of the series, and a partial
  // order would move every episode it never read. Better to give up.
  return stop === "completed" ? publicIds : null;
};

/**
 * Apply the new order of one episode list page.
 *
 * `ReorderEpisodes` takes the whole series in one request — it renumbers
 * `order_index` from the list it is given and rejects anything shorter — but a
 * paginated screen only holds one page of it. So the series' current order is
 * read back here and the page is merged into it before the RPC is called.
 *
 * `currentEpisodePublicIds` is the page's order as the screen was showing it,
 * and the merge writes nothing unless the series still agrees with it — see
 * `mergeEpisodeOrder`.
 */
export const reorderEpisodePage = async (
  input: {
    tenantId: string;
    seriesPublicId: string;
    currentEpisodePublicIds: string[];
    episodePublicIds: string[];
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

  if (input.episodePublicIds.length === 0) {
    return {
      message: t("admin.series.episodes.validation.no_episodes_to_sort"),
      ok: false,
    };
  }

  let seriesPublicIds: string[] | null;
  try {
    seriesPublicIds = await listSeriesEpisodePublicIds({
      seriesPublicId: input.seriesPublicId,
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

  if (!seriesPublicIds) {
    return {
      message: t("admin.series.episodes.reorder_too_many"),
      ok: false,
    };
  }

  const episodePublicIds = mergeEpisodeOrder(
    seriesPublicIds,
    input.currentEpisodePublicIds,
    input.episodePublicIds
  );
  if (!episodePublicIds) {
    return {
      message: t("admin.series.episodes.reorder_conflict"),
      ok: false,
    };
  }

  return await reorderEpisodes(
    {
      episodePublicIds,
      expectedEpisodePublicIds: seriesPublicIds,
      seriesPublicId: input.seriesPublicId,
      tenantId: input.tenantId,
    },
    locale
  );
};

export const reorderEpisodeImages = async (
  input: {
    tenantId: string;
    episodePublicId: string;
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
        episodePublicId: input.episodePublicId,
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
  error: unknown,
  operation: BulkEpisodeCreditOperation,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(
    error,
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
    seriesPublicId: string;
    episodePublicIds: string[];
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
        episodePublicIds: input.episodePublicIds,
        operation: toBulkCreditOperation(input.operation),
        seriesPublicId: input.seriesPublicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      changedEpisodePublicIds: response.changedEpisodePublicIds ?? [],
      ok: true,
      unchangedEpisodes: (response.unchangedEpisodes ?? []).map((episode) => ({
        episodePublicId: episode.episodePublicId,
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
