import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
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

/**
 * The largest page `ListCreators` will serve: the handler falls back to 20 for
 * any `limit` above 100 (`server/api/adminapi/creator_label_handlers.go`).
 */
const CREATOR_PAGE_SIZE = 100;

/**
 * Safety stop for the walk below, in rows. The walk normally ends on the first
 * short page; this only bounds the damage if the server ever stopped honouring
 * `offset`, so that a lookup fails instead of looping forever.
 */
const CREATOR_LOOKUP_MAX_ROWS = 10_000;

/**
 * `creator.proto` has no `GetCreator`, so a single creator can only be found by
 * walking `ListCreators`. One page is not enough to conclude "not found": the
 * server caps a page at `CREATOR_PAGE_SIZE`, and answering `notFound()` from
 * the first page alone would make every creator past that point uneditable.
 *
 * A dedicated `GetCreator` RPC would replace the whole walk.
 */
const findCreatorByPublicId = async (
  tenantId: string,
  publicId: string,
  sessionId: string
): Promise<CreatorItem | null> => {
  for (
    let offset = 0;
    offset < CREATOR_LOOKUP_MAX_ROWS;
    offset += CREATOR_PAGE_SIZE
  ) {
    // Sequential by nature: the next page is only worth asking for once this
    // one has come back full and without a match.
    // oxlint-disable-next-line no-await-in-loop -- paging is inherently serial
    const response = await apiClient.creator.listCreators(
      {
        limit: CREATOR_PAGE_SIZE,
        offset,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    const creators = response.creators ?? [];
    const match = creators.find((item) => item.publicId === publicId);
    if (match) {
      return mapCreator(match);
    }
    if (creators.length < CREATOR_PAGE_SIZE) {
      return null;
    }
  }

  return null;
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
    const creator = await findCreatorByPublicId(
      input.tenantId,
      input.publicId,
      sessionId
    );
    if (!creator) {
      return { notFound: true, ok: false };
    }

    return {
      creator,
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
