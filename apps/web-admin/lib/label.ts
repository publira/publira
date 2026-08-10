import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
import { mentionsImageRejection } from "./image-rejection";
import { findByPublicIdWithToken } from "./paged-lookup";
import { getAccessToken } from "./session";

export interface LabelItem {
  publicId: string;
  name: string;
  eyeCatchImageUpdatedAt: string;
  eyeCatchImageVariants: {
    variantType: string;
    label: string;
    url: string;
    contentType: string;
    width: number;
    height: number;
    fileSizeBytes: number;
  }[];
}

export type ListLabelsResult =
  | { ok: true; labels: LabelItem[] }
  | { ok: false; message: string; labels: LabelItem[] };

export type CreateLabelResult =
  | { ok: true; label: LabelItem }
  | { ok: false; message: string };

export type UpdateLabelResult =
  | { ok: true; label: LabelItem }
  | { ok: false; message: string };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing label from
 * another tenant's label would leak whether it exists.
 *
 * The flag exists because `getLabel()` runs inside a `"use cache: private"`
 * scope, where a thrown `notFound()` is not observable by the caller (#672).
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetLabelResult =
  | { ok: true; label: LabelItem }
  | { notFound: true; ok: false }
  | { message: string; notFound?: false; ok: false };

const genericListErrorMessage =
  "レーベル一覧の取得に失敗しました。時間をおいて再試行してください。";
const genericMutationErrorMessage =
  "レーベルの保存に失敗しました。時間をおいて再試行してください。";

const invalidArgumentMessage = (error: unknown): string =>
  mentionsImageRejection(error)
    ? "画像の設定を確認してください。JPEG/PNG/WebP・10MB以下・2400x3200px以上の画像を選び、もう一度お試しください。"
    : "入力内容に誤りがあります。";

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string =>
  rpcErrorMessage(error, fallbackMessage, {
    "invalid-argument": invalidArgumentMessage(error),
  });

const mapLabel = (label: {
  publicId: string;
  name: string;
  eyeCatchImageUpdatedAt?: string;
  eyeCatchImageVariants?: {
    variantType?: string;
    label?: string;
    url?: string;
    contentType?: string;
    width?: number;
    height?: number;
    fileSizeBytes?: bigint | number;
  }[];
}): LabelItem => ({
  eyeCatchImageUpdatedAt: label.eyeCatchImageUpdatedAt ?? "",
  eyeCatchImageVariants: (label.eyeCatchImageVariants ?? []).flatMap(
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
  name: label.name,
  publicId: label.publicId,
});

export const listLabels = async (
  tenantId: string
): Promise<ListLabelsResult> => {
  "use cache: private";
  cacheTag(`labels-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      labels: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.label.listLabels(
      {
        limit: 100,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      labels: (response.labels ?? [])
        .map((item) => mapLabel(item))
        .toSorted((a, b) => a.name.localeCompare(b.name, "ja")),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      labels: [],
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

export const createLabel = async (input: {
  tenantId: string;
  name: string;
  eyeCatchImageContentType?: string;
  eyeCatchImageData?: Uint8Array;
}): Promise<CreateLabelResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.label.createLabel(
      {
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        name: input.name,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.label?.publicId?.trim()) {
      return {
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      label: mapLabel(response.label),
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

export const updateLabel = async (input: {
  tenantId: string;
  publicId: string;
  name: string;
  clearEyeCatchImage?: boolean;
  eyeCatchImageContentType?: string;
  eyeCatchImageData?: Uint8Array;
}): Promise<UpdateLabelResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.label.updateLabel(
      {
        clearEyeCatchImage: input.clearEyeCatchImage,
        eyeCatchImageContentType: input.eyeCatchImageContentType,
        eyeCatchImageData: input.eyeCatchImageData,
        name: input.name,
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.label?.publicId?.trim()) {
      return {
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      label: mapLabel(response.label),
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

export const getLabel = async (input: {
  tenantId: string;
  publicId: string;
}): Promise<GetLabelResult> => {
  "use cache: private";
  cacheTag(`labels-${input.tenantId}`);
  cacheTag(`label-${input.tenantId}-${input.publicId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    // `label.proto` has no `GetLabel`, so walk the cursor pages until the
    // requested record is found.
    const label = await findByPublicIdWithToken(
      input.publicId,
      async (token, limit) => {
        const response = await apiClient.label.listLabels(
          {
            limit,
            tenant: { tenantId: input.tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.labels,
          nextToken: response.nextToken,
        };
      }
    );
    if (!label) {
      return { notFound: true, ok: false };
    }

    return {
      label: mapLabel(label),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    if (isMissingResourceRpcError(error)) {
      return { notFound: true, ok: false };
    }
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};
