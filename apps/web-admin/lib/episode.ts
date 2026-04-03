import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

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

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string => {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes("unauthenticated") ||
    message.includes("permission_denied")
  ) {
    return "セッションが無効です。再ログインしてください。";
  }

  if (
    message.includes("invalid_argument") ||
    message.includes("required") ||
    message.includes("invalid")
  ) {
    return "入力内容に誤りがあります。";
  }

  if (message.includes("not_found") || message.includes("not found")) {
    return "シリーズが見つかりません。画面を再読み込みして再試行してください。";
  }

  return fallbackMessage;
};

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

const mapEpisodeUploadErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return mapErrorToMessage(error, genericUploadErrorMessage);
  }

  const message = error.message.toLowerCase();

  if (message.includes("valid epub file")) {
    return "ePub の解析に失敗しました。壊れていない ePub（.epub）を選択してください。";
  }

  if (
    message.includes("spine references unknown asset") ||
    message.includes("contains no spine") ||
    message.includes("contains no spine image assets")
  ) {
    return "ePub の本文参照に不整合があります。spine と manifest の参照を確認してください。";
  }

  if (
    message.includes("manifest contains invalid path") ||
    message.includes("invalid path") ||
    message.includes("traversal") ||
    message.includes("outside")
  ) {
    return "ePub 内に不正なパスが含まれています（越境パスや絶対パスは使用できません）。";
  }

  if (message.includes("zip") && message.includes("broken")) {
    return "ZIP が壊れています。正常な ZIP ファイルを再作成してください。";
  }

  if (
    message.includes("zip") &&
    (message.includes("path") ||
      message.includes("traversal") ||
      message.includes("outside"))
  ) {
    return "ZIP 内に不正なパスが含まれています（越境パスや絶対パスは使用できません）。";
  }

  return mapErrorToMessage(error, genericUploadErrorMessage);
};

const uploadArchive = async (input: {
  archive: File;
  episodePublicId: string;
  seriesPublicId?: string;
  tenantPublicId: string;
  sessionId: string;
}) => {
  const request = {
    archiveContentType: input.archive.type || "application/octet-stream",
    archiveData: new Uint8Array(await input.archive.arrayBuffer()),
    archiveFilename: input.archive.name,
    episodePublicId: input.episodePublicId,
    seriesPublicId: input.seriesPublicId ?? "",
    tenant: { tenantPublicId: input.tenantPublicId },
  } as Parameters<typeof apiClient.series.uploadEpisodeImages>[0];

  return apiClient.series.uploadEpisodeImages(
    request,
    withSessionHeaders(input.sessionId)
  );
};

const uploadPages = async (input: {
  pages: File[];
  episodePublicId: string;
  tenantPublicId: string;
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
      tenant: { tenantPublicId: input.tenantPublicId },
    },
    withSessionHeaders(input.sessionId)
  );

export const createEpisode = async (input: {
  tenantPublicId: string;
  seriesPublicId: string;
  title: string;
  orderIndex: number;
  price: number;
  readingPeriodHours: number;
  publishAt: string;
}): Promise<CreateEpisodeResult> => {
  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId: input.tenantPublicId },
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
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const listEpisodes = async (input: {
  tenantPublicId: string;
  seriesPublicId: string;
}): Promise<ListEpisodesResult> => {
  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId: input.tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      episodes: (response.episodes ?? []).map((episode) => mapEpisode(episode)),
      ok: true,
    };
  } catch (error) {
    return {
      episodes: [],
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

export const updateEpisodePublishSchedule = async (input: {
  tenantPublicId: string;
  episodePublicId: string;
  publishAt: string;
}): Promise<UpdateEpisodePublishScheduleResult> => {
  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId: input.tenantPublicId },
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
    return {
      message: mapErrorToMessage(error, genericScheduleErrorMessage),
      ok: false,
    };
  }
};

export const uploadEpisodePages = async (input: {
  tenantPublicId: string;
  episodePublicId: string;
  seriesPublicId?: string;
  pages?: File[];
  archive?: File;
}): Promise<UploadEpisodePagesResult> => {
  const sessionId = await getSessionId();
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
          tenantPublicId: input.tenantPublicId,
        })
      : await uploadPages({
          episodePublicId: input.episodePublicId,
          pages: input.pages ?? [],
          sessionId,
          tenantPublicId: input.tenantPublicId,
        });

    return {
      ok: true,
      uploadedCount: response.images.length,
    };
  } catch (error) {
    return {
      message: mapEpisodeUploadErrorMessage(error),
      ok: false,
    };
  }
};

export const listEpisodeImages = async (input: {
  tenantPublicId: string;
  episodePublicId: string;
}): Promise<ListEpisodeImagesResult> => {
  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId: input.tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      images: (response.images ?? []).map((image) => mapEpisodeImage(image)),
      ok: true,
    };
  } catch (error) {
    return {
      images: [],
      message: mapErrorToMessage(error, genericEpisodeImagesErrorMessage),
      ok: false,
    };
  }
};

export const reorderEpisodes = async (input: {
  tenantPublicId: string;
  seriesPublicId: string;
  episodePublicIds: string[];
}): Promise<ReorderEpisodesResult> => {
  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId: input.tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      episodes: (response.episodes ?? []).map((episode) => mapEpisode(episode)),
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericEpisodeReorderErrorMessage),
      ok: false,
    };
  }
};

export const reorderEpisodeImages = async (input: {
  tenantPublicId: string;
  episodePublicId: string;
  imageIds: string[];
}): Promise<ReorderEpisodeImagesResult> => {
  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId: input.tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      images: (response.images ?? []).map((image) => mapEpisodeImage(image)),
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericEpisodeImageReorderErrorMessage),
      ok: false,
    };
  }
};
