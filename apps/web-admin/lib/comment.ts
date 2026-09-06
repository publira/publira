import type { AdminComment } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";

import { COMMENT_STATUSES } from "../app/[tenant_id]/(protected)/comments/comment-types";
import type {
  CommentActionState,
  CommentHiddenReason,
  CommentItem,
  CommentStatus,
  CountPendingCommentsResult,
  ListCommentsResult,
} from "../app/[tenant_id]/(protected)/comments/comment-types";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CursorPageOptions } from "./cursor-page";
import {
  cursorPageRequest,
  cursorPageTokens,
  emptyCursorPageTokens,
} from "./cursor-page";
import { getAccessToken } from "./session";

/*
 * Neither read here is cached, unlike most of this console's.
 *
 * The moderation queue is filled from outside the console: a reader posting a
 * comment on the storefront is what puts work into it, and nothing on that
 * path can drop a cache entry web-admin holds. A cached queue would go stale
 * for as long as its entry lives, which is exactly the interval in which a
 * moderator is meant to notice the new work. The audit log is uncached for the
 * same reason, and the moderation Actions call `refresh()` rather than
 * `updateTag()` because there is no entry to invalidate.
 */

const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");
const listErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.comments.list_failed");
const countErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.comments.count_failed");

/**
 * The wording each moderation action falls back to when the RPC error has no
 * shared category of its own.
 */
const actionErrorMessage = (
  action: CommentModerationAction,
  messages: SharedMessages
): string => {
  switch (action) {
    case "approve": {
      return getMessage(messages, "admin.comments.approve_failed");
    }
    case "hide": {
      return getMessage(messages, "admin.comments.hide_failed");
    }
    case "restore": {
      return getMessage(messages, "admin.comments.restore_failed");
    }
    default: {
      return getMessage(messages, "admin.comments.purge_failed");
    }
  }
};

const commentStatuses: ReadonlySet<string> = new Set(COMMENT_STATUSES);

/**
 * The stored state, or `pending` for a value this build does not know.
 *
 * A comment whose state cannot be read is still work waiting to be looked at,
 * so it belongs in the queue rather than silently in the published list.
 */
const toCommentStatus = (raw: string): CommentStatus =>
  commentStatuses.has(raw) ? (raw as CommentStatus) : "pending";

const toHiddenReason = (raw: string): CommentHiddenReason => {
  if (raw === "staff" || raw === "auto_reports") {
    return raw;
  }
  return "unknown";
};

/** The generated `AdminComment` fields {@link mapComment} reads (see `series.ts`). */
type RawComment = Pick<
  AdminComment,
  | "authorName"
  | "authorPublicId"
  | "body"
  | "createdAt"
  | "episodePublicId"
  | "episodeTitle"
  | "hiddenAt"
  | "hiddenReason"
  | "publicId"
  | "publishedAt"
  | "purgeDueAt"
  | "seriesPublicId"
  | "seriesTitle"
  | "status"
  | "withdrawnAt"
>;

const mapComment = (item: RawComment): CommentItem => ({
  authorName: item.authorName ?? "",
  authorPublicId: item.authorPublicId ?? "",
  body: item.body ?? "",
  createdAt: item.createdAt ?? "",
  episodePublicId: item.episodePublicId ?? "",
  episodeTitle: item.episodeTitle ?? "",
  hiddenAt: item.hiddenAt ?? "",
  hiddenReason: toHiddenReason(item.hiddenReason ?? ""),
  publicId: item.publicId ?? "",
  publishedAt: item.publishedAt ?? "",
  purgeDueAt: item.purgeDueAt ?? "",
  seriesPublicId: item.seriesPublicId ?? "",
  seriesTitle: item.seriesTitle ?? "",
  status: toCommentStatus(item.status ?? ""),
  withdrawnAt: item.withdrawnAt ?? "",
});

export interface ListCommentsFilters extends CursorPageOptions {
  /** Empty lists every state, which is the whole history in one list. */
  episodePublicId?: string;
  seriesPublicId?: string;
  status?: string;
}

/**
 * One page of the tenant's comments for moderation, newest first.
 *
 * Withdrawn comments are in it. The author's own deletion takes the comment
 * away from every reader, but staff keep reading it until the retention purge
 * removes it, so a dispute raised before the deletion can still be settled.
 */
export const listComments = async (
  tenantId: string,
  locale: Locale,
  filters: ListCommentsFilters = {}
): Promise<ListCommentsResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      ...emptyCursorPageTokens,
      comments: [],
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.comments.listComments(
      {
        ...cursorPageRequest(filters),
        episodePublicId: filters.episodePublicId?.trim() ?? "",
        seriesPublicId: filters.seriesPublicId?.trim() ?? "",
        status: filters.status?.trim() ?? "",
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ...cursorPageTokens(response),
      comments: (response.comments ?? []).map((item) => mapComment(item)),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyCursorPageTokens,
      comments: [],
      message: rpcErrorMessage(error, listErrorMessage(messages), { locale }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Size of the approval queue, for the badge on the navigation entry.
 *
 * A classified failure is a navigation with no badge, not a console that fails
 * to render: the count is chrome, and the moderation screen is where an
 * operator finds out what is actually wrong.
 */
export const countPendingComments = async (
  tenantId: string,
  locale: Locale
): Promise<CountPendingCommentsResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
      pendingCount: 0,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.comments.countPendingComments(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return { ok: true, pendingCount: response.pendingCount ?? 0 };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, countErrorMessage(messages), { locale }),
      ok: false,
      pendingCount: 0,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export type CommentModerationAction = "approve" | "hide" | "purge" | "restore";

export interface ModerateCommentInput {
  action: CommentModerationAction;
  publicId: string;
  /** Recorded on the audit log row. Required for a purge, optional otherwise. */
  reason: string;
  tenantId: string;
}

export type ModerateCommentResult =
  | { message: string; ok: false }
  | { ok: true };

const callModeration = async (
  input: ModerateCommentInput,
  sessionId: string
): Promise<void> => {
  const request = {
    publicId: input.publicId,
    reason: input.reason,
    tenant: { tenantId: input.tenantId },
  };
  const headers = withSessionHeaders(sessionId);

  switch (input.action) {
    case "approve": {
      await apiClient.comments.approveComment(request, headers);
      return;
    }
    case "hide": {
      await apiClient.comments.hideComment(request, headers);
      return;
    }
    case "restore": {
      await apiClient.comments.restoreComment(request, headers);
      return;
    }
    default: {
      await apiClient.comments.purgeComment(request, headers);
    }
  }
};

/**
 * Apply one moderation action to one comment.
 *
 * The four transitions share this entry point because they differ only in
 * which RPC they call: each takes the same comment and the same reason, and
 * each fails the same two ways — a rejected session, which leaves as a throw
 * so the Action can send the operator to sign in, and a state the comment is
 * no longer in, which is a message beside the row.
 */
export const moderateComment = async (
  input: ModerateCommentInput,
  locale: Locale
): Promise<ModerateCommentResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
  }

  try {
    await callModeration(input, sessionId);
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        actionErrorMessage(input.action, messages),
        {
          locale,
          // The comment moved between the screen being rendered and the button
          // being pressed — another moderator got there first.
          overrides: {
            precondition: getMessage(messages, "admin.comments.already_moved"),
          },
        }
      ),
      ok: false,
    };
  }
};

/** A moderation failure, addressed to the row it came from. */
export const commentActionFailure = (
  publicId: string,
  message: string
): CommentActionState => ({ message, ok: false, publicId });
