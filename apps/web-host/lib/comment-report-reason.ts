/**
 * Why a reader says a comment breaks the rules. The stored
 * `episode_comment_reports.reason` values rather than the generated enum, so
 * the chooser, the `FormData` it submits, the Action's schema, and the catalog
 * keys naming each option are all the same four strings; `comments.ts` is where
 * they become the wire enum.
 *
 * Kept apart from `comments.ts` because the report dialog is a Client
 * Component: importing them from the module that holds the RPC calls would pull
 * its `"use cache"` reads into the browser graph.
 */
export type EpisodeCommentReportReason = "abuse" | "other" | "spam" | "spoiler";

/** The order the chooser offers, ending with the one that needs a sentence. */
export const EPISODE_COMMENT_REPORT_REASONS = [
  "spam",
  "abuse",
  "spoiler",
  "other",
] as const satisfies readonly EpisodeCommentReportReason[];

export const isEpisodeCommentReportReason = (
  value: string
): value is EpisodeCommentReportReason =>
  EPISODE_COMMENT_REPORT_REASONS.some((reason) => reason === value);
