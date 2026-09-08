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

/**
 * The three states a stored report can be in, as
 * `proto/publira/admin/v1/comment.proto` defines them. `resolved` is a report
 * staff agreed with and `rejected` one they did not; only `open` counts towards
 * the automatic removal threshold.
 *
 * Kept as the API's own strings for the reason {@link COMMENT_STATUSES} is:
 * they are also the filter the queue RPC takes.
 */
export const COMMENT_REPORT_STATUSES = [
  "open",
  "resolved",
  "rejected",
] as const;

export type CommentReportStatus = (typeof COMMENT_REPORT_STATUSES)[number];

/** The two decisions staff can make about one report. */
export const COMMENT_REPORT_RESOLUTIONS = ["resolved", "rejected"] as const;

export type CommentReportResolution =
  (typeof COMMENT_REPORT_RESOLUTIONS)[number];

/**
 * Why a reader said a comment breaks the rules, as
 * `episode_comment_reports.reason` stores it. Anything else the API sends is
 * `unknown`, so a reason this build does not know degrades to "Something else"
 * rather than to a blank cell.
 */
export type CommentReportReason =
  | "abuse"
  | "other"
  | "spam"
  | "spoiler"
  | "unknown";

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
  /**
   * Distinct reports on this comment that are still open — the number the
   * automatic removal threshold reads, not the number of reports ever made.
   */
  openReportCount: number;
  status: CommentStatus;
  /** When the author deleted the comment. Empty in every other state. */
  withdrawnAt: string;
}

/**
 * One reader's report, with the comment it is about.
 *
 * The comment travels with the report because a report cannot be judged
 * without the text it names, and the queue offers the same removal actions the
 * comment list does from the same row.
 */
export interface CommentReportItem {
  comment: CommentItem;
  createdAt: string;
  /** What the reporter added in their own words. Usually empty. */
  note: string;
  reason: CommentReportReason;
  /** The report's identifier, which is a uuid rather than a `public_id`. */
  reportId: string;
  reporterName: string;
  reporterPublicId: string;
  /** When staff decided this report. Empty while it is open. */
  resolvedAt: string;
  status: CommentReportStatus;
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

export type ListCommentReportsResult = CursorPageTokens &
  (
    | {
        ok: true;
        reports: CommentReportItem[];
      }
    | {
        message: string;
        ok: false;
        reports: CommentReportItem[];
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

/**
 * What one report decision reports back to the row it was submitted from.
 *
 * Keyed by `reportId` rather than by the comment's `publicId` for the reason
 * {@link CommentActionState} is keyed at all: a comment several readers
 * reported is several rows in the queue, and a failure has to appear under the
 * one that was pressed.
 */
export type CommentReportActionState = {
  message: string;
  ok: boolean;
  reportId: string;
} | null;
