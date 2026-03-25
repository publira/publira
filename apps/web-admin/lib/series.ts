import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

export interface SeriesItem {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  labelName: string;
  creatorNames: string[];
  creatorPublicIds: string[];
  isPublished: boolean;
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
    return "入力内容に誤りがあります。";
  }

  if (
    message.includes("already_exists") ||
    message.includes("already exists")
  ) {
    return "重複するデータがあるため保存できません。";
  }

  return fallbackMessage;
};

const mapSeries = (series: {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours?: number;
  label?: { name: string };
  creators: { publicId: string; name: string }[];
}): SeriesItem => ({
  creatorNames: (series.creators ?? [])
    .map((creator) => creator.name.trim())
    .filter((name) => name.length > 0),
  creatorPublicIds: (series.creators ?? [])
    .map((creator) => creator.publicId.trim())
    .filter((publicId) => publicId.length > 0),
  isPublished: false,
  labelName: series.label?.name?.trim() ?? "",
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
    return {
      defaultReadingPeriodHours: 0,
      message: mapErrorToMessage(error, genericListErrorMessage),
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
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
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
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
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
  creatorPublicIds: string[];
  isPublished: boolean;
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
        creatorPublicIds: input.creatorPublicIds,
        isPublished: input.isPublished,
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
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};
