import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions, CursorPageTokens } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getAccessToken } from "./session";

export interface CreatorItem {
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl: string;
  iconImageFileSizeBytes: number;
  iconImageUpdatedAt: string;
}

export type ListCreatorsResult = CursorPageTokens &
  (
    | { ok: true; creators: CreatorItem[] }
    | { ok: false; message: string; creators: CreatorItem[] }
  );

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
  tenantId: string,
  options: CursorPageOptions = {}
): Promise<ListCreatorsResult> => {
  "use cache: private";
  cacheTag(`creators-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.creator.listCreators(
      {
        ...cursorPageRequest(options),
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      // Keep the server's keyset order; client re-sorting would break paging.
      creators: (response.creators ?? []).map((item) => mapCreator(item)),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: mapErrorToMessage(error, genericListErrorMessage),
      ok: false,
    };
  }
};

/**
 * Every creator in the tenant for combobox pickers (series form, etc.).
 *
 * Walks `ListCreators` cursor pages so the client-side Combobox can search
 * beyond a single RPC page. The `/creators` list keeps {@link listCreators}
 * (one page) so list paging stays independent of picker loading.
 *
 * Sorted by name for readable search results. An incomplete walk (budget
 * exhausted or a repeated token) fails with an empty list rather than a
 * partial option set that would hide creators beyond the rows already read.
 */
export const listAllCreators = async (
  tenantId: string
): Promise<ListCreatorsResult> => {
  "use cache: private";
  cacheTag(`creators-${tenantId}`);

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      creators: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const creators: CreatorItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.creator.listCreators(
          {
            limit,
            tenant: { tenantId },
            token,
          },
          withSessionHeaders(sessionId)
        );
        return {
          items: response.creators ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          creators.push(mapCreator(item));
        }
      }
    );

    // Match episode reorder: a partial walk must not surface a half-built
    // option list that operators treat as complete.
    if (walkStop !== "completed") {
      return {
        ...emptyCursorPageTokens,
        creators: [],
        message: genericListErrorMessage,
        ok: false,
      };
    }

    return {
      ...emptyCursorPageTokens,
      creators: creators.toSorted((a, b) => a.name.localeCompare(b.name, "ja")),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
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
    const response = await apiClient.creator.getCreator(
      {
        publicId: input.publicId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.creator?.publicId?.trim()) {
      return {
        message: genericListErrorMessage,
        ok: false,
      };
    }

    return {
      creator: mapCreator(response.creator),
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
