import type { Series } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";

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

export type ListSeriesResult = CursorPageTokens &
  (
    | {
        ok: true;
        series: SeriesItem[];
        defaultReadingPeriodHours: number;
      }
    | {
        ok: false;
        message: string;
        series: SeriesItem[];
        defaultReadingPeriodHours: number;
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type CreateSeriesResult =
  | { ok: true; series: SeriesItem }
  | { ok: false; message: string };

export type UpdateSeriesResult =
  | { ok: true; series: SeriesItem }
  | { ok: false; message: string };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing series from
 * another tenant's series would leak whether it exists.
 *
 * The flag exists because `getSeries()` runs inside a `"use cache: private"`
 * scope, where a thrown `notFound()` is not observable by the caller (#672).
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetSeriesResult =
  | { ok: true; series: SeriesItem }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

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

/**
 * The generated `Series` fields {@link mapSeries} reads. Naming them against
 * the message type is what makes a proto rename fail here — a restated
 * structural type keeps compiling, and the mapper silently substitutes an empty
 * string for the field it can no longer find.
 */
type RawSeries = Pick<
  Series,
  | "creators"
  | "eyeCatchImageUpdatedAt"
  | "eyeCatchImageVariants"
  | "isPublished"
  | "label"
  | "publicId"
  | "publishedAt"
  | "readingPeriodHours"
  | "synopsis"
  | "title"
>;

const mapSeries = (series: RawSeries): SeriesItem => ({
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
  isPublished: series.isPublished ?? false,
  labelName: series.label?.name?.trim() ?? "",
  labelPublicId: series.label?.publicId?.trim() ?? "",
  publicId: series.publicId,
  publishedAt: series.publishedAt ?? "",
  readingPeriodHours: series.readingPeriodHours ?? 0,
  synopsis: series.synopsis,
  title: series.title,
});

/**
 * One page of the tenant's series, newest first.
 *
 * The rows keep the server's keyset order (`created_at`, `id` descending).
 * Sorting them here would only sort the rows that happen to share a page, which
 * reads as a broken order as soon as the list spans more than one page.
 */
export const listSeries = async (
  tenantId: string,
  options: CursorPageOptions = {}
): Promise<ListSeriesResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
      series: [],
    };
  }

  try {
    const response = await apiClient.series.listSeries(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      defaultReadingPeriodHours: response.defaultReadingPeriodHours ?? 0,
      ok: true,
      series: (response.series ?? []).map((item) => mapSeries(item)),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      series: [],
    };
  }
};

/**
 * Every series in the tenant for combobox pickers (access-ticket form).
 *
 * Walks `ListSeries` cursor pages so the client-side Combobox can search
 * beyond a single RPC page. The `/series` list keeps {@link listSeries}
 * (one page) so list paging stays independent of picker loading.
 *
 * Sorted by title for readable search results. An incomplete walk (budget
 * exhausted or a repeated token) fails with an empty list rather than a
 * partial option set that would hide series beyond the rows already read.
 *
 * Deliberately uncached: series mutations do not `updateTag` a tenant-wide
 * series list, so a cache tag here would keep a newly created series out of
 * the picker until the entry expired.
 */
export const listAllSeries = async (
  tenantId: string
): Promise<ListSeriesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
      series: [],
    };
  }

  try {
    const series: SeriesItem[] = [];
    let defaultReadingPeriodHours = 0;
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.series.listSeries(
          {
            limit,
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        defaultReadingPeriodHours = response.defaultReadingPeriodHours ?? 0;
        return {
          items: response.series ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          series.push(mapSeries(item));
        }
      }
    );

    // Match listAllCreators / episode reorder: never hand the form a partial
    // option list that operators treat as complete.
    if (walkStop !== "completed") {
      return {
        ...emptyCursorPageTokens,
        defaultReadingPeriodHours: 0,
        message: genericListErrorMessage,
        ok: false,
        requiresSignIn: false,
        series: [],
      };
    }

    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours,
      ok: true,
      series: series.toSorted((a, b) => a.title.localeCompare(b.title, "ja")),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      defaultReadingPeriodHours: 0,
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
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
      requiresSignIn: true,
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
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
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
    rethrowUnauthenticatedRpcError(error);
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};
