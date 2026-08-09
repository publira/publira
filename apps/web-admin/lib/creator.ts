import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
import { findByPublicId } from "./paged-lookup";
import { getAccessToken } from "./session";

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

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`. It carries no message: the screen is replaced
 * by `not-found.tsx`, and wording that distinguished a missing creator from
 * another tenant's creator would leak whether it exists.
 *
 * The flag exists because `getCreator()` runs inside a `"use cache: private"`
 * scope, where a thrown `notFound()` is not observable by the caller (#672).
 * The interrupt has to be raised by the caller, outside the cache scope.
 */
export type GetCreatorResult =
  | { ok: true; creator: CreatorItem }
  | { notFound: true; ok: false }
  | { message: string; notFound?: false; ok: false };

const genericListErrorMessage =
  "著者一覧の取得に失敗しました。時間をおいて再試行してください。";
const genericMutationErrorMessage =
  "著者の保存に失敗しました。時間をおいて再試行してください。";

const mapErrorToMessage = (error: unknown, fallbackMessage: string): string =>
  rpcErrorMessage(error, fallbackMessage);

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
  tenantId: string
): Promise<ListCreatorsResult> => {
  "use cache: private";
  cacheTag(`creators-${tenantId}`);

  const sessionId = await getAccessToken();
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
        tenant: { tenantId },
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
    rethrowUnclassifiedRpcError(error);
    return {
      creators: [],
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

export const createCreator = async (input: {
  tenantId: string;
  name: string;
  profileText: string;
  iconImageContentType?: string;
  iconImageData?: Uint8Array;
}): Promise<CreateCreatorResult> => {
  const sessionId = await getAccessToken();
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
        tenant: { tenantId: input.tenantId },
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const updateCreator = async (input: {
  tenantId: string;
  publicId: string;
  name: string;
  profileText: string;
  clearIconImage?: boolean;
  iconImageContentType?: string;
  iconImageData?: Uint8Array;
}): Promise<UpdateCreatorResult> => {
  const sessionId = await getAccessToken();
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
        tenant: { tenantId: input.tenantId },
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: mapErrorToMessage(error, genericMutationErrorMessage),
      ok: false,
    };
  }
};

export const getCreator = async (input: {
  tenantId: string;
  publicId: string;
}): Promise<GetCreatorResult> => {
  "use cache: private";
  cacheTag(`creators-${input.tenantId}`);
  cacheTag(`creator-${input.tenantId}-${input.publicId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    // `creator.proto` has no `GetCreator`, so the record has to be found by
    // walking `ListCreators`; see `findByPublicId`.
    const creator = await findByPublicId(
      input.publicId,
      async (offset, limit) => {
        const response = await apiClient.creator.listCreators(
          {
            limit,
            offset,
            tenant: { tenantId: input.tenantId },
          },
          withSessionHeaders(sessionId)
        );
        return response.creators ?? [];
      }
    );
    if (!creator) {
      return { notFound: true, ok: false };
    }

    return {
      creator: mapCreator(creator),
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
