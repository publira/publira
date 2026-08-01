import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
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

export type GetLabelResult =
  | { ok: true; label: LabelItem }
  | { ok: false; message: string };

const genericListErrorMessage =
  "レーベル一覧の取得に失敗しました。時間をおいて再試行してください。";
const genericMutationErrorMessage =
  "レーベルの保存に失敗しました。時間をおいて再試行してください。";

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
      return "画像の設定を確認してください。JPEG/PNG/WebP・10MB以下・2400x3200px以上の画像を選び、もう一度お試しください。";
    }

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
  eyeCatchImageVariants: (label.eyeCatchImageVariants ?? [])
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
        offset: 0,
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
    const response = await listLabels(input.tenantId);

    if (!response.ok) {
      return {
        message: response.message,
        ok: false,
      };
    }

    const label = response.labels.find(
      (item) => item.publicId === input.publicId
    );
    if (!label) {
      return {
        message: "レーベルが見つかりません。",
        ok: false,
      };
    }

    return {
      label,
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};
