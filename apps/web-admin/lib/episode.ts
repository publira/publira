import type { Episode, EpisodeImage } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  RPC_ERROR_REASON,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { DEFAULT_LOCALE, getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";

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
import { getAccessToken } from "./session";

export interface EpisodeItem {
  publicId: string;
  title: string;
  orderIndex: number;
  price: number;
  readingPeriodHours: number;
  status: string;
  scheduledAt: string;
  publishedAt: string;
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
  | { ok: true; episode: EpisodeItem }
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

/**
 * Page size for the order-index scan a reorder needs. The RPC caps `limit` at
 * 100, so this is the fewest round trips a series can be read in.
 */
const reorderScanPageSize = 100;

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const mutationErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.create_failed");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.list_failed");
const getErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.get_failed");
const scheduleErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.schedule_failed");
const uploadErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.upload_failed");
const episodeImagesErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.image_list_failed");
const episodeReorderErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.reorder_failed");
const episodeImageReorderErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.image_reorder_failed");
const episodeOrderConflictMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.series.episodes.reorder_conflict");

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): string =>
  rpcErrorMessage(error, fallbackMessage, {
    locale,
    overrides: {
      "not-found": getMessage(
        sharedCatalog(locale),
        "admin.series.episodes.series_not_found"
      ),
    },
  });

const mapReorderErrorToMessage = (error: unknown, locale: Locale): string => {
  const messages = sharedCatalog(locale);

  return rpcErrorMessage(error, episodeReorderErrorMessage(messages), {
    locale,
    overrides: {
      "not-found": getMessage(
        messages,
        "admin.series.episodes.series_not_found"
      ),
      precondition: episodeOrderConflictMessage(messages),
    },
  });
};

/** The generated `Episode` fields {@link mapEpisode} reads (see `series.ts`). */
type RawEpisode = Pick<
  Episode,
  | "orderIndex"
  | "price"
  | "publicId"
  | "publishedAt"
  | "readingPeriodHours"
  | "scheduledAt"
  | "status"
  | "title"
>;

const mapEpisode = (episode: RawEpisode): EpisodeItem => ({
  orderIndex: episode.orderIndex,
  price: episode.price,
  publicId: episode.publicId,
  publishedAt: episode.publishedAt,
  readingPeriodHours: episode.readingPeriodHours ?? 0,
  scheduledAt: episode.scheduledAt,
  status: episode.status,
  title: episode.title,
});

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

/**
 * Every archive rejection is `invalid_argument`, so the code alone cannot say
 * whether the ePub is unreadable, its spine is inconsistent, or an entry path
 * escapes the archive — and an uploader needs to know which. The server sends
 * those cases as stable `google.rpc.ErrorInfo` reasons.
 */
const archiveRejectionMessage = (
  error: unknown,
  messages: SharedMessages
): string | undefined => {
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.archiveInvalidEPUB)) {
    return getMessage(messages, "admin.series.episodes.epub_invalid");
  }
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.archiveInvalidEPUBSpine)) {
    return getMessage(messages, "admin.series.episodes.epub_spine_invalid");
  }
  return rpcErrorHasReason(error, RPC_ERROR_REASON.archiveInvalidPath)
    ? getMessage(messages, "admin.series.episodes.archive_path_invalid")
    : undefined;
};

const mapEpisodeUploadErrorMessage = (
  error: unknown,
  locale: Locale
): string => {
  const messages = sharedCatalog(locale);

  return rpcErrorMessage(error, uploadErrorMessage(messages), {
    locale,
    overrides: {
      "invalid-argument":
        archiveRejectionMessage(error, messages) ??
        getMessage(messages, "errors.rpc.invalid-argument"),
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
  },
  locale: Locale = DEFAULT_LOCALE
): Promise<CreateEpisodeResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.createEpisode(
      {
        // Omitting orderIndex makes the server append to the end.
        price: input.price,
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
        message: mutationErrorMessage(messages),
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
      message: mapErrorToMessage(error, mutationErrorMessage(messages), locale),
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
  locale: Locale = DEFAULT_LOCALE
): Promise<ListEpisodesResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: sessionErrorMessage(messages),
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
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
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
  locale: Locale = DEFAULT_LOCALE
): Promise<ListEpisodesResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: sessionErrorMessage(messages),
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
        message: listErrorMessage(messages),
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
      message: mapErrorToMessage(error, listErrorMessage(messages), locale),
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
  locale: Locale = DEFAULT_LOCALE
): Promise<GetEpisodeResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
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

    if (!response.episode?.publicId?.trim()) {
      return {
        message: getErrorMessage(messages),
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: mapErrorToMessage(error, getErrorMessage(messages), locale),
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
  locale: Locale = DEFAULT_LOCALE
): Promise<UpdateEpisodePublishScheduleResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
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
        message: scheduleErrorMessage(messages),
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
      message: mapErrorToMessage(error, scheduleErrorMessage(messages), locale),
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
  locale: Locale = DEFAULT_LOCALE
): Promise<UploadEpisodePagesResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  if (!input.archive && (!input.pages || input.pages.length === 0)) {
    return {
      message: getMessage(
        messages,
        "admin.series.episodes.validation.pages_required"
      ),
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
      message: mapEpisodeUploadErrorMessage(error, locale),
      ok: false,
    };
  }
};

export const listEpisodeImages = async (
  input: {
    tenantId: string;
    episodePublicId: string;
  },
  locale: Locale = DEFAULT_LOCALE
): Promise<ListEpisodeImagesResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      images: [],
      message: sessionErrorMessage(messages),
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
      message: mapErrorToMessage(
        error,
        episodeImagesErrorMessage(messages),
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
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  if (input.episodePublicIds.length === 0) {
    return {
      message: getMessage(
        messages,
        "admin.series.episodes.validation.no_episodes_to_sort"
      ),
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
      message: mapReorderErrorToMessage(error, locale),
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
  locale: Locale = DEFAULT_LOCALE
): Promise<ReorderEpisodesResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  if (input.episodePublicIds.length === 0) {
    return {
      message: getMessage(
        messages,
        "admin.series.episodes.validation.no_episodes_to_sort"
      ),
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
      message: mapErrorToMessage(
        error,
        episodeReorderErrorMessage(messages),
        locale
      ),
      ok: false,
    };
  }

  if (!seriesPublicIds) {
    return {
      message: getMessage(messages, "admin.series.episodes.reorder_too_many"),
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
      message: episodeOrderConflictMessage(messages),
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
  locale: Locale = DEFAULT_LOCALE
): Promise<ReorderEpisodeImagesResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
    };
  }

  if (input.imageIds.length === 0) {
    return {
      message: getMessage(
        messages,
        "admin.series.episodes.validation.no_images_to_sort"
      ),
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
      message: mapErrorToMessage(
        error,
        episodeImageReorderErrorMessage(messages),
        locale
      ),
      ok: false,
    };
  }
};
