import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorMentions,
} from "@publira/api-client/errors";

import { apiClient, withSessionHeaders } from "./api";
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

export type ListEpisodesResult =
  | { ok: true; episodes: EpisodeItem[] }
  | { ok: false; message: string; episodes: EpisodeItem[] };

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

const genericMutationErrorMessage =
  "エピソードの入稿に失敗しました。時間をおいて再試行してください。";
const genericListErrorMessage =
  "エピソード一覧の取得に失敗しました。時間をおいて再試行してください。";
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

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string =>
  rpcErrorMessage(error, fallbackMessage, {
    "not-found":
      "シリーズが見つかりません。画面を再読み込みして再試行してください。",
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
  orderIndex: number;
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
        orderIndex: input.orderIndex,
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

export const listEpisodes = async (input: {
  tenantId: string;
  seriesPublicId: string;
}): Promise<ListEpisodesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      episodes: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.listEpisodes(
      {
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
      episodes: [],
      message: mapErrorToMessage(error, genericListErrorMessage),
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

export const reorderEpisodes = async (input: {
  tenantId: string;
  seriesPublicId: string;
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

  try {
    const response = await apiClient.series.reorderEpisodes(
      {
        episodePublicIds: input.episodePublicIds,
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
      message: mapErrorToMessage(error, genericEpisodeReorderErrorMessage),
      ok: false,
    };
  }
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
