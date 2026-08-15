import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorMentions,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";

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
    | { ok: false; message: string; episodes: EpisodeItem[] }
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
  | { message: string; notFound?: false; ok: false };

export type UpdateEpisodePublishScheduleResult =
  | { ok: true; episode: EpisodeItem }
  | { ok: false; message: string };

export type UploadEpisodePagesResult =
  | { ok: true; uploadedCount: number }
  | { ok: false; message: string };

export type ListEpisodeImagesResult =
  | { ok: true; images: EpisodeImageItem[] }
  | { ok: false; message: string; images: EpisodeImageItem[] };

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

const genericMutationErrorMessage =
  "エピソードの入稿に失敗しました。時間をおいて再試行してください。";
const genericListErrorMessage =
  "エピソード一覧の取得に失敗しました。時間をおいて再試行してください。";
const genericGetErrorMessage =
  "エピソードの取得に失敗しました。時間をおいて再試行してください。";
const genericScheduleErrorMessage =
  "公開設定の更新に失敗しました。時間をおいて再試行してください。";
const genericUploadErrorMessage =
  "ページ画像の追加に失敗しました。時間をおいて再試行してください。";
const genericEpisodeImagesErrorMessage =
  "ページ画像一覧の取得に失敗しました。時間をおいて再試行してください。";
const genericEpisodeReorderErrorMessage =
  "エピソードの並び順更新に失敗しました。時間をおいて再試行してください。";
const genericEpisodeImageReorderErrorMessage =
  "ページ画像の並び順更新に失敗しました。時間をおいて再試行してください。";
const episodeOrderConflictMessage =
  "他の操作でエピソードの構成か並び順が変わったため、並び順を更新できませんでした。画面を再読み込みして再試行してください。";

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string =>
  rpcErrorMessage(error, fallbackMessage, {
    "not-found":
      "シリーズが見つかりません。画面を再読み込みして再試行してください。",
  });

const mapReorderErrorToMessage = (error: unknown): string =>
  rpcErrorMessage(error, genericEpisodeReorderErrorMessage, {
    "not-found":
      "シリーズが見つかりません。画面を再読み込みして再試行してください。",
    precondition: episodeOrderConflictMessage,
  });

const mapEpisode = (episode: {
  publicId: string;
  title: string;
  orderIndex: number;
  price: number;
  readingPeriodHours?: number;
  status: string;
  scheduledAt: string;
  publishedAt: string;
}): EpisodeItem => ({
  orderIndex: episode.orderIndex,
  price: episode.price,
  publicId: episode.publicId,
  publishedAt: episode.publishedAt,
  readingPeriodHours: episode.readingPeriodHours ?? 0,
  scheduledAt: episode.scheduledAt,
  status: episode.status,
  title: episode.title,
});

const mapEpisodeImage = (image: {
  id: string;
  imageUrl: string;
  contentType: string;
  fileSizeBytes: bigint;
  displayOrder: number;
  width: number;
  height: number;
}): EpisodeImageItem => ({
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
 * escapes the archive — and an uploader needs to know which.
 *
 * The tokens mirror the only three messages `server/internal/epubimages`
 * produces; anything else falls through to the generic wording, as does a
 * rewording on the server.
 */
const archiveRejectionMessage = (error: unknown): string | undefined => {
  if (rpcErrorMentions(error, "valid epub file")) {
    return "ePub の解析に失敗しました。壊れていない ePub（.epub）を選択してください。";
  }
  if (rpcErrorMentions(error, "contains no spine")) {
    return "ePub の本文参照に不整合があります。spine と manifest の参照を確認してください。";
  }
  // Covers both `epub manifest contains invalid path` and
  // `archive contains invalid path`.
  return rpcErrorMentions(error, "invalid path")
    ? "アーカイブ内に不正なパスが含まれています（越境パスや絶対パスは使用できません）。"
    : undefined;
};

const mapEpisodeUploadErrorMessage = (error: unknown): string =>
  rpcErrorMessage(error, genericUploadErrorMessage, {
    "invalid-argument":
      archiveRejectionMessage(error) ?? "入力内容に誤りがあります。",
  });

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

export const createEpisode = async (input: {
  tenantId: string;
  seriesPublicId: string;
  title: string;
  price: number;
  readingPeriodHours: number;
  publishAt: string;
}): Promise<CreateEpisodeResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.createEpisode(
      {
        // orderIndex を省くとサーバーが末尾に追加する。
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
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
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
  } & CursorPageOptions
): Promise<ListEpisodesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
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
      message: mapErrorToMessage(error, genericListErrorMessage),
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
  seriesPublicId: string;
  tenantId: string;
}): Promise<ListEpisodesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      episodes: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
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
        message: genericListErrorMessage,
        ok: false,
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
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

export const getEpisode = async (input: {
  tenantId: string;
  seriesPublicId: string;
  publicId: string;
}): Promise<GetEpisodeResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
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
        message: genericGetErrorMessage,
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
      message: mapErrorToMessage(error, genericGetErrorMessage),
      ok: false,
    };
  }
};

export const updateEpisodePublishSchedule = async (input: {
  tenantId: string;
  episodePublicId: string;
  publishAt: string;
}): Promise<UpdateEpisodePublishScheduleResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
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
        message: genericScheduleErrorMessage,
        ok: false,
      };
    }

    return {
      episode: mapEpisode(response.episode),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericScheduleErrorMessage),
      ok: false,
    };
  }
};

export const uploadEpisodePages = async (input: {
  tenantId: string;
  episodePublicId: string;
  seriesPublicId?: string;
  pages?: File[];
  archive?: File;
}): Promise<UploadEpisodePagesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (!input.archive && (!input.pages || input.pages.length === 0)) {
    return {
      message: "追加するページ画像を選択してください。",
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapEpisodeUploadErrorMessage(error),
      ok: false,
    };
  }
};

export const listEpisodeImages = async (input: {
  tenantId: string;
  episodePublicId: string;
}): Promise<ListEpisodeImagesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      images: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
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
      message: mapErrorToMessage(error, genericEpisodeImagesErrorMessage),
      ok: false,
    };
  }
};

const reorderEpisodes = async (input: {
  tenantId: string;
  seriesPublicId: string;
  episodePublicIds: string[];
  expectedEpisodePublicIds: string[];
}): Promise<ReorderEpisodesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (input.episodePublicIds.length === 0) {
    return {
      message: "並び替え対象のエピソードがありません。",
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapReorderErrorToMessage(error),
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
export const reorderEpisodePage = async (input: {
  tenantId: string;
  seriesPublicId: string;
  currentEpisodePublicIds: string[];
  episodePublicIds: string[];
}): Promise<ReorderEpisodesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (input.episodePublicIds.length === 0) {
    return {
      message: "並び替え対象のエピソードがありません。",
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericEpisodeReorderErrorMessage),
      ok: false,
    };
  }

  if (!seriesPublicIds) {
    return {
      message:
        "エピソードが多すぎて並び順を更新できませんでした。時間をおいて再試行してください。",
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
      message: episodeOrderConflictMessage,
      ok: false,
    };
  }

  return await reorderEpisodes({
    episodePublicIds,
    expectedEpisodePublicIds: seriesPublicIds,
    seriesPublicId: input.seriesPublicId,
    tenantId: input.tenantId,
  });
};

export const reorderEpisodeImages = async (input: {
  tenantId: string;
  episodePublicId: string;
  imageIds: string[];
}): Promise<ReorderEpisodeImagesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  if (input.imageIds.length === 0) {
    return {
      message: "並び替え対象の画像がありません。",
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericEpisodeImageReorderErrorMessage),
      ok: false,
    };
  }
};
