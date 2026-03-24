import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

export interface LabelItem {
  publicId: string;
  name: string;
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

const mapLabel = (label: { publicId: string; name: string }): LabelItem => ({
  name: label.name,
  publicId: label.publicId,
});

export const listLabels = async (
  tenantPublicId: string
): Promise<ListLabelsResult> => {
  "use cache: private";
  cacheTag(`labels-${tenantPublicId}`);

  const sessionId = await getSessionId();
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
        tenant: { tenantPublicId },
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
  tenantPublicId: string;
  name: string;
}): Promise<CreateLabelResult> => {
  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.label.createLabel(
      {
        name: input.name,
        tenant: { tenantPublicId: input.tenantPublicId },
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
  tenantPublicId: string;
  publicId: string;
  name: string;
}): Promise<UpdateLabelResult> => {
  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.label.updateLabel(
      {
        name: input.name,
        publicId: input.publicId,
        tenant: { tenantPublicId: input.tenantPublicId },
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
  tenantPublicId: string;
  publicId: string;
}): Promise<GetLabelResult> => {
  "use cache: private";
  cacheTag(`labels-${input.tenantPublicId}`);
  cacheTag(`label-${input.tenantPublicId}-${input.publicId}`);

  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await listLabels(input.tenantPublicId);

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
