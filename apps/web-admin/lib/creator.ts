import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

export interface CreatorItem {
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl: string;
  iconImageFileSizeBytes: number;
  iconImageUpdatedAt: string;
}

export type ListCreatorsResult =
  | { ok: true; creators: CreatorItem[] }
  | { ok: false; message: string; creators: CreatorItem[] };

export type CreateCreatorResult =
  | { ok: true; creator: CreatorItem }
  | { ok: false; message: string };

export type UpdateCreatorResult =
  | { ok: true; creator: CreatorItem }
  | { ok: false; message: string };

export type GetCreatorResult =
  | { ok: true; creator: CreatorItem }
  | { ok: false; message: string };

const genericListErrorMessage =
  "著者一覧の取得に失敗しました。時間をおいて再試行してください。";
const genericMutationErrorMessage =
  "著者の保存に失敗しました。時間をおいて再試行してください。";

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

const mapCreator = (creator: {
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl?: string;
  iconImageFileSizeBytes?: bigint | number;
  iconImageUpdatedAt?: string;
}): CreatorItem => ({
  iconImageFileSizeBytes:
    creator.iconImageFileSizeBytes === undefined
      ? 0
      : Number(creator.iconImageFileSizeBytes),
  iconImageUpdatedAt: creator.iconImageUpdatedAt ?? "",
  iconImageUrl: creator.iconImageUrl ?? "",
  name: creator.name,
  profileText: creator.profileText,
  publicId: creator.publicId,
});

export const listCreators = async (
  tenantPublicId: string
): Promise<ListCreatorsResult> => {
  "use cache: private";
  cacheTag(`creators-${tenantPublicId}`);

  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      creators: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.creator.listCreators(
      {
        limit: 100,
        offset: 0,
        tenant: { tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      creators: (response.creators ?? [])
        .map((item) => mapCreator(item))
        .toSorted((a, b) => a.name.localeCompare(b.name, "ja")),
      ok: true,
    };
  } catch (error) {
    return {
      creators: [],
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

export const createCreator = async (input: {
  tenantPublicId: string;
  name: string;
  profileText: string;
  iconImageContentType?: string;
  iconImageData?: Uint8Array;
}): Promise<CreateCreatorResult> => {
  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.creator.createCreator(
      {
        iconImageContentType: input.iconImageContentType,
        iconImageData: input.iconImageData,
        name: input.name,
        profileText: input.profileText,
        tenant: { tenantPublicId: input.tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      creator: mapCreator(response.creator),
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const updateCreator = async (input: {
  tenantPublicId: string;
  publicId: string;
  name: string;
  profileText: string;
  clearIconImage?: boolean;
  iconImageContentType?: string;
  iconImageData?: Uint8Array;
}): Promise<UpdateCreatorResult> => {
  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.creator.updateCreator(
      {
        clearIconImage: input.clearIconImage,
        iconImageContentType: input.iconImageContentType,
        iconImageData: input.iconImageData,
        name: input.name,
        profileText: input.profileText,
        publicId: input.publicId,
        tenant: { tenantPublicId: input.tenantPublicId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: genericMutationErrorMessage,
        ok: false,
      };
    }

    return {
      creator: mapCreator(response.creator),
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const getCreator = async (input: {
  tenantPublicId: string;
  publicId: string;
}): Promise<GetCreatorResult> => {
  "use cache: private";
  cacheTag(`creators-${input.tenantPublicId}`);
  cacheTag(`creator-${input.tenantPublicId}-${input.publicId}`);

  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await listCreators(input.tenantPublicId);

    if (!response.ok) {
      return {
        message: response.message,
        ok: false,
      };
    }

    const creator = response.creators.find(
      (c) => c.publicId === input.publicId
    );
    if (!creator) {
      return {
        message: "著者が見つかりません。",
        ok: false,
      };
    }

    return {
      creator,
      ok: true,
    };
  } catch (error) {
    return {
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};
