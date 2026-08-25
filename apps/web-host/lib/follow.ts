import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { FollowTargetType } from "@publira/api-client/public/catalog";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { applyCacheTag, tenantFollowsTag } from "./cache-tags";

/** Public catalog follow targets this app exposes on detail pages (#1130). */
export const followTargetKinds = ["author", "series"] as const;
export type FollowTargetKind = (typeof followTargetKinds)[number];

const followTargetTypeByKind: Record<FollowTargetKind, FollowTargetType> = {
  author: FollowTargetType.AUTHOR,
  series: FollowTargetType.SERIES,
};

const followTargetKindByType: Partial<
  Record<FollowTargetType, FollowTargetKind>
> = {
  [FollowTargetType.AUTHOR]: "author",
  [FollowTargetType.SERIES]: "series",
};

export const toFollowTargetType = (kind: FollowTargetKind): FollowTargetType =>
  followTargetTypeByKind[kind];

/** `null` for episode / unspecified — this app has no public page for those. */
export const toFollowTargetKind = (
  type: FollowTargetType
): FollowTargetKind | null => followTargetKindByType[type] ?? null;

const sessionErrorMessage = "セッションが無効です。再ログインしてください。";
const statusErrorMessage =
  "フォロー状態を取得できませんでした。時間をおいて再試行してください。";
const followErrorMessage =
  "フォロー操作に失敗しました。時間をおいて再試行してください。";
const unfollowErrorMessage =
  "フォローの解除に失敗しました。時間をおいて再試行してください。";

/**
 * Tag the private follow-status and follow-list reads carry, so `updateTag`
 * in the Server Action refreshes only this member's follow island and list —
 * not the public series or author catalog cache.
 */
export const followsCacheTag = tenantFollowsTag;

export type FollowStatusResult =
  | { isFollowing: boolean; ok: true; signedIn: boolean }
  | { message: string; ok: false };

type CachedFollowStatusResult = FollowStatusResult & {
  unexpected: boolean;
};

const isUnexpectedError = (error: unknown): boolean =>
  rpcErrorDisposition(error) === "unexpected";

const throwIfUnexpected = (unexpected: boolean, message: string): void => {
  if (unexpected) {
    throw new Error(message);
  }
};

const followTargetMessage = (kind: FollowTargetKind, publicId: string) => ({
  publicId,
  type: toFollowTargetType(kind),
});

const readFollowStatus = async (
  tenantId: string,
  targetKind: FollowTargetKind,
  publicId: string
): Promise<CachedFollowStatusResult> => {
  "use cache: private";
  applyCacheTag(followsCacheTag(tenantId));

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      isFollowing: false,
      ok: true,
      signedIn: false,
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.follow.getMyFollowStatus(
      {
        target: followTargetMessage(targetKind, publicId),
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );

    return {
      isFollowing: response.isFollowing ?? false,
      ok: true,
      signedIn: true,
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    if (isUnauthenticatedRpcError(error)) {
      return {
        isFollowing: false,
        ok: true,
        signedIn: false,
        unexpected: false,
      };
    }
    return {
      message: rpcErrorMessage(error, statusErrorMessage),
      ok: false,
      unexpected: isUnexpectedError(error),
    };
  }
};

/**
 * The current member's follow state for one public catalog target.
 *
 * Guests skip the RPC: no session means "not signed in", which the island
 * turns into a login link. A rejected session is treated the same way so a
 * stale cookie does not personalize — or fail — the surrounding public page.
 */
export const getMyFollowStatus = async (
  tenantId: string,
  targetKind: FollowTargetKind,
  publicId: string
): Promise<FollowStatusResult> => {
  const { unexpected, ...result } = await readFollowStatus(
    tenantId,
    targetKind,
    publicId
  );
  throwIfUnexpected(
    unexpected,
    result.ok ? statusErrorMessage : result.message
  );
  return result;
};

export const followTarget = async (input: {
  publicId: string;
  targetKind: FollowTargetKind;
  tenantId: string;
}): Promise<
  { isFollowing: boolean; ok: true } | { message: string; ok: false }
> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
    };
  }

  try {
    await apiClient.follow.follow(
      {
        target: followTargetMessage(input.targetKind, input.publicId),
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return { isFollowing: true, ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, followErrorMessage),
      ok: false,
    };
  }
};

export const unfollowTarget = async (input: {
  publicId: string;
  targetKind: FollowTargetKind;
  tenantId: string;
}): Promise<
  { isFollowing: boolean; ok: true } | { message: string; ok: false }
> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
    };
  }

  try {
    await apiClient.follow.unfollow(
      {
        target: followTargetMessage(input.targetKind, input.publicId),
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return { isFollowing: false, ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, unfollowErrorMessage),
      ok: false,
    };
  }
};
