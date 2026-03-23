import { createAdminApiClient } from "@publira/api-client/admin/client";
import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE_NAME } from "./admin-auth-shared";

// gRPC transport is used for internal Next.js → Go API communication
const grpcBaseUrl =
  process.env.PUBLIRA_ADMIN_GRPC_URL ?? "http://localhost:8101";

const adminApiClient = createAdminApiClient({
  baseUrl: grpcBaseUrl,
  transport: "grpc",
});

const buildSessionHeaders = (sessionId: string) =>
  ({ headers: { "X-Publira-Session-Id": sessionId } }) as never;

const resolveSessionId = async (): Promise<string> => {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
};

export interface SeriesItem {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  labelName: string;
  creatorNames: string[];
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
  creators: { name: string }[];
}): SeriesItem => ({
  creatorNames: (series.creators ?? [])
    .map((creator) => creator.name.trim())
    .filter((name) => name.length > 0),
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
  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return {
      defaultReadingPeriodHours: 0,
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      series: [],
    };
  }

  try {
    const response = await adminApiClient.series.listSeries(
      {
        limit: 100,
        offset: 0,
        tenant: { tenantPublicId },
      },
      buildSessionHeaders(sessionId)
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
  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await adminApiClient.series.getSeries(
      {
        publicId: input.publicId,
        tenant: { tenantPublicId: input.tenantPublicId },
      },
      buildSessionHeaders(sessionId)
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
  isPublished: boolean;
}): Promise<CreateSeriesResult> => {
  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await adminApiClient.series.createSeries(
      {
        isPublished: input.isPublished,
        labelPublicId: input.labelPublicId,
        readingPeriodHours: input.readingPeriodHours,
        synopsis: input.synopsis,
        tenant: { tenantPublicId: input.tenantPublicId },
        title: input.title,
      },
      buildSessionHeaders(sessionId)
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
  isPublished: boolean;
}): Promise<UpdateSeriesResult> => {
  const sessionId = await resolveSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await adminApiClient.series.updateSeries(
      {
        isPublished: input.isPublished,
        publicId: input.publicId,
        readingPeriodHours: input.readingPeriodHours,
        synopsis: input.synopsis,
        tenant: { tenantPublicId: input.tenantPublicId },
        title: input.title,
      },
      buildSessionHeaders(sessionId)
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
