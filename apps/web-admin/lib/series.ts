import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";

import { apiClient, withSessionHeaders } from "./api";
import { mentionsImageRejection } from "./image-rejection";
import { getAccessToken } from "./session";

export interface SeriesItem {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  publishedAt: string;
  labelPublicId: string;
  labelName: string;
  creatorNames: string[];
  creatorPublicIds: string[];
  isPublished: boolean;
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

export type ListSeriesResult =
  | { ok: true; series: SeriesItem[]; defaultReadingPeriodHours: number }
  | {
      ok: false;
      message: string;
      series: SeriesItem[];
      defaultReadingPeriodHours: number;
    };

export type CreateSeriesResult =
  | { ok: true; series: SeriesItem }
  | { ok: false; message: string };

export type UpdateSeriesResult =
  | { ok: true; series: SeriesItem }
  | { ok: false; message: string };

export type GetSeriesResult =
  | { ok: true; series: SeriesItem }
  | { ok: false; message: string };

const genericListErrorMessage =
  "シリーズ一覧の取得に失敗しました。時間をおいて再試行してください。";
const genericMutationErrorMessage =
  "シリーズの保存に失敗しました。時間をおいて再試行してください。";

const invalidArgumentMessage = (error: unknown): string =>
  mentionsImageRejection(error)
    ? "画像の設定を確認してください。JPEG/PNG/WebP・10MB以下・推奨サイズを満たす画像を選び、もう一度お試しください。"
    : "入力内容を確認してください。タイトル・ラベル・作者などの必須項目を見直して、もう一度お試しください。";

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string =>
  rpcErrorMessage(error, fallbackMessage, {
    "invalid-argument": invalidArgumentMessage(error),
    "not-found":
      "対象のシリーズが見つかりませんでした。ページを再読み込みして、もう一度お試しください。",
  });

const mapSeries = (series: {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours?: number;
  isPublished?: boolean;
  publishedAt?: string;
  label?: { publicId: string; name: string };
  creators: { publicId: string; name: string }[];
  eyeCatchImageVariants?: {
    variantType?: string;
    label?: string;
    url?: string;
    contentType?: string;
    width?: number;
    height?: number;
    fileSizeBytes?: bigint | number;
  }[];
  eyeCatchImageUpdatedAt?: string;
}): SeriesItem => ({
  creatorNames: (series.creators ?? []).flatMap((creator) => {
    const name = creator.name.trim();
    return name.length > 0 ? [name] : [];
  }),
  creatorPublicIds: (series.creators ?? []).flatMap((creator) => {
    const publicId = creator.publicId.trim();
    return publicId.length > 0 ? [publicId] : [];
  }),
  eyeCatchImageUpdatedAt: series.eyeCatchImageUpdatedAt ?? "",
  eyeCatchImageVariants: (series.eyeCatchImageVariants ?? []).flatMap(
    (variant) => {
      const mappedVariant = {
        contentType: variant.contentType ?? "",
        fileSizeBytes:
          variant.fileSizeBytes === undefined
            ? 0
            : Number(variant.fileSizeBytes),
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
  isPublished: series.isPublished ?? false,
  labelName: series.label?.name?.trim() ?? "",
  labelPublicId: series.label?.publicId?.trim() ?? "",
  publicId: series.publicId,
  publishedAt: series.publishedAt ?? "",
  readingPeriodHours: series.readingPeriodHours ?? 0,
  synopsis: series.synopsis,
  title: series.title,
});

export const listSeries = async (
  tenantId: string
): Promise<ListSeriesResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      defaultReadingPeriodHours: 0,
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      series: [],
    };
  }

  try {
    const response = await apiClient.series.listSeries(
      {
        limit: 100,
        offset: 0,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      defaultReadingPeriodHours: response.defaultReadingPeriodHours ?? 0,
      ok: true,
      series: (response.series ?? [])
        .map((item) => mapSeries(item))
        .toSorted((a, b) => a.title.localeCompare(b.title, "ja")),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      defaultReadingPeriodHours: 0,
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
      series: [],
    };
  }
};

export const getSeries = async (input: {
  tenantId: string;
  publicId: string;
}): Promise<GetSeriesResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.getSeries(
      {
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.series?.publicId?.trim()) {
      return {
        message: genericListErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      series: mapSeries(response.series),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

export const createSeries = async (input: {
  tenantId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  labelPublicId: string;
  creatorPublicIds: string[];
  isPublished: boolean;
  publishedAt?: string;
  eyeCatchImageContentType?: string;
  eyeCatchImageData?: Uint8Array;
}): Promise<CreateSeriesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.createSeries(
      {
        creatorPublicIds: input.creatorPublicIds,
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        isPublished: input.isPublished,
        labelPublicId: input.labelPublicId,
        publishedAt: input.publishedAt,
        readingPeriodHours: input.readingPeriodHours,
        synopsis: input.synopsis,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.series?.publicId?.trim()) {
      return {
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      series: {
        ...mapSeries(response.series),
        isPublished: input.isPublished,
      },
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const updateSeries = async (input: {
  tenantId: string;
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  labelPublicId: string;
  creatorPublicIds: string[];
  isPublished: boolean;
  publishedAt?: string;
  clearEyeCatchImage?: boolean;
  eyeCatchImageContentType?: string;
  eyeCatchImageData?: Uint8Array;
}): Promise<UpdateSeriesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.series.updateSeries(
      {
        clearEyeCatchImage: input.clearEyeCatchImage,
        creatorPublicIds: input.creatorPublicIds,
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        isPublished: input.isPublished,
        labelPublicId: input.labelPublicId,
        publicId: input.publicId,
        publishedAt: input.publishedAt,
        readingPeriodHours: input.readingPeriodHours,
        synopsis: input.synopsis,
        tenant: { tenantId: input.tenantId },
        title: input.title,
      },
      withSessionHeaders(sessionId)
    );

    if (!response.series?.publicId?.trim()) {
      return {
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      ok: true,
      series: {
        ...mapSeries(response.series),
        isPublished: input.isPublished,
      },
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};
