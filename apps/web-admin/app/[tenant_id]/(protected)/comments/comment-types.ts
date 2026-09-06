import type { CursorPageTokens } from "#lib/cursor-page";

/**
 * The four states a stored comment can be in, as
 * `proto/publira/admin/v1/comment.proto` defines them.
 *
 * The screen keeps them as the API's own strings rather than mapping them to a
 * console vocabulary of its own: they are also the filter the list RPC takes,
 * so a second set of names would have to be translated back on every request.
 */
export const COMMENT_STATUSES = [
  "pending",
  "published",
  "hidden",
  "withdrawn",
] as const;

export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/**
 * Who removed a comment that is `hidden`: a moderator, or the report threshold
 * acting with no actor to name. Anything else the API sends is `unknown`, so an
 * unrecognised value degrades to "removed" rather than to a blank cell.
 */
export type CommentHiddenReason = "auto_reports" | "staff" | "unknown";

export interface CommentItem {
  authorName: string;
  authorPublicId: string;
  body: string;
  createdAt: string;
  episodePublicId: string;
  episodeTitle: string;
  /** Empty in every state but `hidden`. */
  hiddenAt: string;
  hiddenReason: CommentHiddenReason;
  publicId: string;
  /** When the comment first became publicly readable; empty if it never did. */
  publishedAt: string;
  /** Deadline of the retention purge, set only on a withdrawn comment. */
  purgeDueAt: string;
  seriesPublicId: string;
  seriesTitle: string;
  status: CommentStatus;
  /** When the author deleted the comment. Empty in every other state. */
  withdrawnAt: string;
}

export type ListCommentsResult = CursorPageTokens &
  (
    | {
        comments: CommentItem[];
        ok: true;
      }
    | {
        comments: CommentItem[];
        message: string;
        ok: false;
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type CountPendingCommentsResult =
  | { ok: true; pendingCount: number }
  | {
      message: string;
      ok: false;
      /** The API rejected the session — the navigation stays quiet about it. */
      requiresSignIn: boolean;
      pendingCount: number;
    };

/**
 * What one moderation action reports back to the row it was submitted from.
 *
 * `publicId` is what lets a row show only its own failure: every row on the
 * screen submits to the same Action, and a message with no owner would appear
 * under all of them.
 */
export type CommentActionState = {
  message: string;
  ok: boolean;
  publicId: string;
} | null;
