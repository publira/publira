import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isMissingResourceRpcError,
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type {
  EpisodeComment,
  MyEpisodeComment,
} from "@publira/api-client/public/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";
import type { CachedReadResult } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { applyCacheTag, tenantEpisodeCommentsTag } from "./cache-tags";
import { loadHostMessages } from "./messages";
import { localizedReadFailure } from "./read-failure";

/**
 * One of this section's own failure sentences, in the reader's language. It is
 * the fallback `rpcErrorMessage` uses for the categories its shared table has
 * no wording for.
 */
const commentMessage = async (
  locale: Locale,
  key:
    | "host.episode.comments.delete_failed"
    | "host.episode.comments.own_failed"
    | "host.episode.comments.post_failed"
): Promise<string> => getMessage(await loadHostMessages(locale), key);

/** Rows one comment page asks the API for. The server caps this at 100. */
const COMMENT_PAGE_SIZE = 20;

/**
 * How many of the viewer's own comments are read alongside a public page.
 *
 * These are the ones the public list cannot carry — awaiting approval, or
 * removed — so a reader has a handful of them on an episode at most. Reading
 * the server's maximum in one request is what lets them be placed by date
 * among the public rows instead of being paged on their own.
 */
const OWN_COMMENT_PAGE_SIZE = 100;

/**
 * One comment as the section renders it, whoever wrote it.
 *
 * `awaitingApproval` is true only for a comment nobody but its author can read
 * yet. It is deliberately **not** a removal flag: a comment staff took down
 * keeps whatever value it had, because its author is never told (see
 * `proto/publira/v1/comment.proto`).
 */
export interface EpisodeCommentItem {
  /** Empty on the viewer's own rows the public list does not carry. */
  authorPublicId: string;
  authorName: string;
  awaitingApproval: boolean;
  body: string;
  createdAt: string;
  publicId: string;
}

export interface EpisodeCommentPage {
  comments: EpisodeCommentItem[];
  nextToken: string;
  previousToken: string;
}

export interface ListEpisodeCommentsInput {
  episodePublicId: string;
  /** UI locale the failure wording belongs to, and part of the cache key. */
  locale: Locale;
  token?: string;
}

const emptyPage: EpisodeCommentPage = {
  comments: [],
  nextToken: "",
  previousToken: "",
};

/**
 * The generated `EpisodeComment` fields {@link toPublicComment} reads. Naming
 * them against the message is what makes a proto rename fail here rather than
 * leaving the section rendering rows whose body silently became an empty
 * string.
 */
type RawEpisodeComment = Pick<
  EpisodeComment,
  "authorName" | "authorPublicId" | "body" | "createdAt" | "publicId"
>;

/** The generated `MyEpisodeComment` fields {@link toOwnComment} reads. */
type RawMyEpisodeComment = Pick<
  MyEpisodeComment,
  "awaitingApproval" | "body" | "createdAt" | "publicId"
>;

const toPublicComment = (comment: RawEpisodeComment): EpisodeCommentItem => ({
  authorName: comment.authorName ?? "",
  authorPublicId: comment.authorPublicId ?? "",
  awaitingApproval: false,
  body: comment.body ?? "",
  createdAt: comment.createdAt ?? "",
  publicId: comment.publicId ?? "",
});

/**
 * The viewer's own comment, given the author the message leaves out: it is the
 * caller, so the API does not repeat their name back to them.
 */
const toOwnComment = (
  comment: RawMyEpisodeComment,
  author: { name: string; publicId: string }
): EpisodeCommentItem => ({
  authorName: author.name,
  authorPublicId: author.publicId,
  awaitingApproval: comment.awaitingApproval === true,
  body: comment.body ?? "",
  createdAt: comment.createdAt ?? "",
  publicId: comment.publicId ?? "",
});

/**
 * One page of the episode's published comments, newest first.
 *
 * Public and identical for every reader, which is what lets it be cached: a
 * comment in any other state reaches its author through
 * {@link listMyEpisodeComments} instead, so no viewer's pending or removed row
 * can enter a shared entry.
 *
 * A missing episode answers with an empty page rather than a failure. The page
 * around this section resolves the episode itself and has already answered
 * `notFound()` by the time that could matter.
 */
export const listEpisodeComments = async (
  tenantId: string,
  input: ListEpisodeCommentsInput
): Promise<CachedReadResult<EpisodeCommentPage>> => {
  "use cache";
  applyCacheTag(tenantEpisodeCommentsTag(tenantId, input.episodePublicId));

  try {
    const response = await apiClient.comment.listEpisodeComments({
      episodePublicId: input.episodePublicId,
      limit: COMMENT_PAGE_SIZE,
      tenant: { tenantId },
      token: input.token ?? "",
    });

    return {
      ok: true,
      value: {
        comments: (response.comments ?? []).map(toPublicComment),
        nextToken: response.nextToken ?? "",
        previousToken: response.previousToken ?? "",
      },
    };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { ok: true, value: emptyPage };
    }
    return await localizedReadFailure<EpisodeCommentPage>(
      error,
      input.locale,
      "host.episode.comments.list_failed"
    );
  }
};

export interface ListMyEpisodeCommentsInput extends ListEpisodeCommentsInput {
  /** The viewer, so their own rows can carry the name the message omits. */
  author: { name: string; publicId: string };
}

/**
 * The viewer's own comments on this episode that the public list omits.
 *
 * Deliberately **uncached**, where the public list above is cached for
 * everyone. These rows belong to one reader — a comment awaiting approval, or
 * one staff removed — and the only way to be sure none of them ever reaches
 * another reader is for no cache entry to hold them at all. The section calls
 * this inside its own `<Suspense>`, so the request it makes dynamic is that
 * boundary rather than the episode page.
 */
export const listMyEpisodeComments = async (
  tenantId: string,
  input: ListMyEpisodeCommentsInput
): Promise<CachedReadResult<EpisodeCommentItem[]>> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    // Not a failure: a reader without a session has no comments of their own,
    // and the section renders the sign-in prompt rather than a message.
    return { ok: true, value: [] };
  }

  try {
    const response = await apiClient.comment.listMyEpisodeComments(
      {
        episodePublicId: input.episodePublicId,
        limit: OWN_COMMENT_PAGE_SIZE,
        tenant: { tenantId },
        token: "",
      },
      buildSessionHeaders(sessionId)
    );

    return {
      ok: true,
      value: (response.comments ?? []).map((comment) =>
        toOwnComment(comment, input.author)
      ),
    };
  } catch (error) {
    // A session the API rejected leaves the reader with no comments of their
    // own rather than with a message: the surrounding section already resolved
    // the viewer, so it is showing the sign-in prompt for the same reason.
    if (isMissingResourceRpcError(error) || isUnauthenticatedRpcError(error)) {
      return { ok: true, value: [] };
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        await commentMessage(input.locale, "host.episode.comments.own_failed"),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};

/**
 * Newest first by absolute time, the order both lists already arrive in.
 * Unparseable timestamps sort last rather than silently becoming the epoch,
 * and the public id breaks a tie so the merged order is stable.
 */
const compareNewestFirst = (
  left: EpisodeCommentItem,
  right: EpisodeCommentItem
): number => {
  const leftAt = parseInstant(left.createdAt);
  const rightAt = parseInstant(right.createdAt);
  if (leftAt && rightAt) {
    const byTime = Temporal.Instant.compare(rightAt, leftAt);
    if (byTime !== 0) {
      return byTime;
    }
    return right.publicId.localeCompare(left.publicId);
  }
  if (leftAt) {
    return -1;
  }
  if (rightAt) {
    return 1;
  }
  return right.publicId.localeCompare(left.publicId);
};

/**
 * True while `createdAt` falls inside the stretch of time the public page
 * covers.
 *
 * A page's own rows define that stretch: its newest row is the upper bound
 * whenever an earlier page exists, and its oldest row the lower bound whenever
 * a later one does. Either bound is open on the outermost page, which is what
 * puts a brand new comment of the viewer's on the first page. Without this the
 * same private row would be repeated on every page, and repetition is exactly
 * the kind of marker a removed comment must not acquire.
 */
const withinPageWindow = (
  createdAt: string,
  bounds: { newest?: string; oldest?: string }
): boolean => {
  const at = parseInstant(createdAt);
  if (!at) {
    return false;
  }
  const newest = bounds.newest ? parseInstant(bounds.newest) : null;
  if (newest && Temporal.Instant.compare(at, newest) > 0) {
    return false;
  }
  const oldest = bounds.oldest ? parseInstant(bounds.oldest) : null;
  return !(oldest && Temporal.Instant.compare(at, oldest) < 0);
};

/**
 * Fold the viewer's own comments into the public page they belong on, in date
 * order.
 *
 * Placing them by date is the whole point: a comment staff removed has to read
 * exactly as it did before, so it cannot be pinned to the top, badged, or
 * moved into a list of its own.
 *
 * A page with no public rows takes the own comments only when it is the one
 * and only page. A `?token=` that lands past the end of the list has no window
 * to place anything in, and showing the reader's own comments there would make
 * that empty page look like a page of theirs.
 */
export const mergeOwnEpisodeComments = (
  page: EpisodeCommentPage,
  ownComments: EpisodeCommentItem[]
): EpisodeCommentItem[] => {
  if (ownComments.length === 0) {
    return page.comments;
  }
  if (page.comments.length === 0) {
    if (page.nextToken || page.previousToken) {
      return page.comments;
    }
    return ownComments.toSorted(compareNewestFirst);
  }

  const bounds = {
    newest: page.previousToken ? page.comments[0]?.createdAt : undefined,
    oldest: page.nextToken ? page.comments.at(-1)?.createdAt : undefined,
  };
  const placed = ownComments.filter((comment) =>
    withinPageWindow(comment.createdAt, bounds)
  );

  return [...page.comments, ...placed].toSorted(compareNewestFirst);
};

export interface PostEpisodeCommentInput {
  body: string;
  episodePublicId: string;
  locale: Locale;
  tenantId: string;
}

export type PostEpisodeCommentResult =
  | { awaitingApproval: boolean; ok: true }
  | { message: string; ok: false };

/**
 * Post one comment as the signed-in reader.
 *
 * `awaitingApproval` is what the caller tells the reader afterwards: under
 * `approval_required` the comment is stored but nobody else can read it yet.
 */
export const postEpisodeComment = async (
  input: PostEpisodeCommentInput
): Promise<PostEpisodeCommentResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    // The Action resolves the session before calling this, so an empty token
    // here means it expired in between; the caller sends the reader to sign in.
    return {
      message: await commentMessage(
        input.locale,
        "host.episode.comments.post_failed"
      ),
      ok: false,
    };
  }

  try {
    const response = await apiClient.comment.postEpisodeComment(
      {
        body: input.body,
        episodePublicId: input.episodePublicId,
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return {
      awaitingApproval: response.comment?.awaitingApproval === true,
      ok: true,
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        await commentMessage(input.locale, "host.episode.comments.post_failed"),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};

export interface WithdrawEpisodeCommentInput {
  commentPublicId: string;
  locale: Locale;
  tenantId: string;
}

export type WithdrawEpisodeCommentResult =
  | { message: string; ok: false }
  | { ok: true };

/**
 * Take one of the reader's own comments down. It leaves every list, the
 * author's own included.
 */
export const withdrawEpisodeComment = async (
  input: WithdrawEpisodeCommentInput
): Promise<WithdrawEpisodeCommentResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: await commentMessage(
        input.locale,
        "host.episode.comments.delete_failed"
      ),
      ok: false,
    };
  }

  try {
    await apiClient.comment.withdrawEpisodeComment(
      {
        commentPublicId: input.commentPublicId,
        tenant: { tenantId: input.tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        await commentMessage(
          input.locale,
          "host.episode.comments.delete_failed"
        ),
        { locale: input.locale }
      ),
      ok: false,
    };
  }
};
