import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { MyFollow } from "@publira/api-client/public/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { getPublishedAuthorDetail } from "./authors";
import { applyCacheTag } from "./cache-tags";
import { getSeriesDetail } from "./catalog";
import { followsCacheTag, toFollowTargetKind } from "./follow";
import type { FollowTargetKind } from "./follow";
import { loadHostMessages } from "./messages";

/**
 * `locale` reaches the read as an argument rather than being resolved inside
 * the cached scope, so the failure wording belongs to the cache key instead of
 * to whichever request filled the entry.
 */
const followListMessage = async (
  locale: Locale,
  key: "errors.rpc.unauthenticated" | "host.settings.follows_failed"
): Promise<string> => getMessage(await loadHostMessages(locale), key);

const defaultFollowPageSize = 20;

/**
 * The generated `MyFollow` fields {@link mapMyFollow} reads. Naming them
 * against the message type is what makes a proto rename fail here.
 */
type RawMyFollow = Pick<
  MyFollow,
  "followedAt" | "targetPublicId" | "targetType"
>;

export interface FollowListEntry {
  followedAt: string;
  publicId: string;
  targetKind: FollowTargetKind;
}

export interface FollowListItem extends FollowListEntry {
  href: string | undefined;
  title: string;
  unavailable: boolean;
}

export type ListMyFollowsResult =
  | {
      follows: FollowListEntry[];
      nextToken: string;
      ok: true;
      previousToken: string;
    }
  | {
      follows: FollowListEntry[];
      message: string;
      nextToken: string;
      ok: false;
      previousToken: string;
      requiresSignIn: boolean;
    };

type CachedListMyFollowsResult = ListMyFollowsResult & {
  unexpected: boolean;
};

export interface ListMyFollowsInput {
  limit?: number;
  /** UI locale the failure wording belongs to; part of the cache key. */
  locale: Locale;
  token?: string;
}

const emptyFollowPage = {
  follows: [] as FollowListEntry[],
  nextToken: "",
  previousToken: "",
};

const isUnexpectedError = (error: unknown): boolean =>
  rpcErrorDisposition(error) === "unexpected";

/**
 * Only an expired or missing session sends the reader back through login.
 * `InvalidArgument` is not a session problem here: a cursor token can pass
 * the base64url shape check and still be rejected by `ListMyFollows`.
 * Treating that as sign-in would bounce the same `?token=` URL after login.
 */
const isSignInRequiredError = (error: unknown): boolean =>
  isRpcError(error, Code.Unauthenticated);

const throwIfUnexpected = (unexpected: boolean, message: string): void => {
  if (unexpected) {
    throw new Error(message);
  }
};

const mapMyFollow = (item: RawMyFollow): FollowListEntry | null => {
  const publicId = item.targetPublicId?.trim() ?? "";
  const targetKind = toFollowTargetKind(item.targetType);
  if (!(publicId && targetKind)) {
    return null;
  }
  return {
    followedAt: item.followedAt ?? "",
    publicId,
    targetKind,
  };
};

const followHref = (kind: FollowTargetKind, publicId: string): string =>
  kind === "author" ? `/authors/${publicId}` : `/series/${publicId}`;

const unavailableItem = (
  follow: FollowListEntry,
  unpublishedTitle: string
): FollowListItem => ({
  ...follow,
  href: undefined,
  title: unpublishedTitle,
  unavailable: true,
});

const availableItem = (
  follow: FollowListEntry,
  title: string
): FollowListItem => ({
  ...follow,
  href: followHref(follow.targetKind, follow.publicId),
  title: title.trim() || follow.publicId,
  unavailable: false,
});

/** A private, paged list of the signed-in member's currently public follows. */
const readFollowList = async (
  tenantId: string,
  input: ListMyFollowsInput
): Promise<CachedListMyFollowsResult> => {
  "use cache: private";
  applyCacheTag(followsCacheTag(tenantId));

  const { locale } = input;
  const [messages, sessionId] = await Promise.all([
    loadHostMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyFollowPage,
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
      unexpected: false,
    };
  }

  try {
    const response = await apiClient.follow.listMyFollows(
      {
        limit: input.limit ?? defaultFollowPageSize,
        tenant: { tenantId },
        token: input.token ?? "",
      },
      buildSessionHeaders(sessionId)
    );
    return {
      follows: (response.follows ?? []).flatMap((item) => {
        const mapped = mapMyFollow(item);
        return mapped ? [mapped] : [];
      }),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      ...emptyFollowPage,
      message: rpcErrorMessage(
        error,
        getMessage(messages, "host.settings.follows_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isSignInRequiredError(error),
      unexpected: isUnexpectedError(error),
    };
  }
};

export const listMyFollows = async (
  tenantId: string,
  input: ListMyFollowsInput
): Promise<ListMyFollowsResult> => {
  const { unexpected, ...result } = await readFollowList(tenantId, input);
  throwIfUnexpected(
    unexpected,
    result.ok
      ? await followListMessage(input.locale, "host.settings.follows_failed")
      : result.message
  );
  return result;
};

/**
 * Resolve public catalog titles and hrefs for a page of follows. Catalog
 * reads stay on the shared public cache; a missing target is treated as
 * unpublished rather than distinguished from not-found.
 */
export const resolveFollowListItems = async (
  tenantId: string,
  follows: FollowListEntry[],
  locale: Locale
): Promise<FollowListItem[]> => {
  const messages = await loadHostMessages(locale);
  const unpublishedTitle = getMessage(
    messages,
    "host.settings.follows_unpublished_title"
  );

  return Promise.all(
    follows.map(async (follow) => {
      if (follow.targetKind === "author") {
        const result = await getPublishedAuthorDetail(
          tenantId,
          follow.publicId,
          { limit: 1, locale }
        );
        if (!result.ok) {
          return availableItem(follow, follow.publicId);
        }
        if (!result.value) {
          return unavailableItem(follow, unpublishedTitle);
        }
        return availableItem(follow, result.value.name);
      }

      const result = await getSeriesDetail(tenantId, follow.publicId, locale);
      if (!result.ok) {
        return availableItem(follow, follow.publicId);
      }
      if (!result.value) {
        return unavailableItem(follow, unpublishedTitle);
      }
      return availableItem(follow, result.value.series.title);
    })
  );
};
