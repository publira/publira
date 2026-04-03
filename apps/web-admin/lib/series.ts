import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

export interface SeriesItem {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
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
    if (
      message.includes("eye_catch") ||
      message.includes("image") ||
      message.includes("content_type") ||
      message.includes("10mb") ||
      message.includes("at least")
    ) {
      return "画像の設定を確認してください。JPEG/PNG/WebP・10MB以下・推奨サイズを満たす画像を選び、もう一度お試しください。";
    }

    return "入力内容を確認してください。タイトル・ラベル・作者などの必須項目を見直して、もう一度お試しください。";
  }

  if (
    message.includes("already_exists") ||
    message.includes("already exists")
  ) {
    return "重複するデータがあるため保存できません。";
  }

  if (message.includes("not_found")) {
    return "対象のシリーズが見つかりませんでした。ページを再読み込みして、もう一度お試しください。";
  }

  return fallbackMessage;
};

const mapSeries = (series: {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours?: number;
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
  creatorNames: (series.creators ?? [])
    .map((creator) => creator.name.trim())
    .filter((name) => name.length > 0),
  creatorPublicIds: (series.creators ?? [])
    .map((creator) => creator.publicId.trim())
    .filter((publicId) => publicId.length > 0),
  eyeCatchImageUpdatedAt: series.eyeCatchImageUpdatedAt ?? "",
  eyeCatchImageVariants: (series.eyeCatchImageVariants ?? [])
    .map((variant) => ({
      contentType: variant.contentType ?? "",
      fileSizeBytes:
        variant.fileSizeBytes === undefined ? 0 : Number(variant.fileSizeBytes),
      height: variant.height ?? 0,
      label: variant.label ?? "",
      url: variant.url ?? "",
      variantType: variant.variantType ?? "",
      width: variant.width ?? 0,
    }))
    .filter((variant) => variant.label.length > 0 && variant.url.length > 0),
  isPublished: false,
  labelName: series.label?.name?.trim() ?? "",
  labelPublicId: series.label?.publicId?.trim() ?? "",
  publicId: series.publicId,
  readingPeriodHours: series.readingPeriodHours ?? 0,
  synopsis: series.synopsis,
  title: series.title,
});

export const listSeries = async (
  tenantPublicId: string
): Promise<ListSeriesResult> => {
  "use cache: private";

  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId },
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
    console.error("[web-admin] listSeries failed", {
      error,
      tenantPublicId,
    });

    const message = mapErrorToMessage(error, genericListErrorMessage);
    return {
      defaultReadingPeriodHours: 0,
      message,
      ok: false,
      series: [],
    };
  }
};

export const getSeries = async (input: {
  tenantPublicId: string;
  publicId: string;
}): Promise<GetSeriesResult> => {
  "use cache: private";

  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId: input.tenantPublicId },
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
    console.error("[web-admin] getSeries failed", {
      error,
      publicId: input.publicId,
      tenantPublicId: input.tenantPublicId,
    });

    const message = mapErrorToMessage(error, genericListErrorMessage);
    return {
      message,
      ok: false,
    };
  }
};

export const createSeries = async (input: {
  tenantPublicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  labelPublicId: string;
  creatorPublicIds: string[];
  isPublished: boolean;
  eyeCatchImageContentType?: string;
  eyeCatchImageData?: Uint8Array;
}): Promise<CreateSeriesResult> => {
  const sessionId = await getSessionId();
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
        readingPeriodHours: input.readingPeriodHours,
        synopsis: input.synopsis,
        tenant: { tenantPublicId: input.tenantPublicId },
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
    console.error("[web-admin] createSeries failed", {
      error,
      input,
    });

    const message = mapErrorToMessage(error, genericMutationErrorMessage);
    return {
      message,
      ok: false,
    };
  }
};

export const updateSeries = async (input: {
  tenantPublicId: string;
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  labelPublicId: string;
  creatorPublicIds: string[];
  isPublished: boolean;
  clearEyeCatchImage?: boolean;
  eyeCatchImageContentType?: string;
  eyeCatchImageData?: Uint8Array;
}): Promise<UpdateSeriesResult> => {
  const sessionId = await getSessionId();
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
        readingPeriodHours: input.readingPeriodHours,
        synopsis: input.synopsis,
        tenant: { tenantPublicId: input.tenantPublicId },
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
    console.error("[web-admin] updateSeries failed", {
      error,
      input,
    });

    const message = mapErrorToMessage(error, genericMutationErrorMessage);
    return {
      message,
      ok: false,
    };
  }
};
