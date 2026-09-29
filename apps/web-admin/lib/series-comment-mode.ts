import type { TenantCommentMode } from "./tenant-comment-settings-shared";
import { TENANT_COMMENT_MODES } from "./tenant-comment-settings-shared";

/**
 * The mode one series publishes comments under.
 *
 * The three a tenant states, plus the empty value for a series that states
 * none of its own — `series_listings.comment_mode` being NULL, which is what
 * keeps the series following the tenant setting after that setting changes.
 *
 * Strings rather than the generated `CommentMode` enum, because that is what a
 * form posts and what a `<select>` holds. `series.ts` is where they meet the
 * enum, and it is in the server graph — this module is the half a Client
 * Component may import.
 */
export type SeriesCommentMode = "" | TenantCommentMode;

/**
 * The order the series form offers: the tenant's own setting first, because a
 * series following it is the state every series starts in.
 */
export const SERIES_COMMENT_MODES = [
  "",
  ...TENANT_COMMENT_MODES,
] as const satisfies readonly SeriesCommentMode[];

export const isSeriesCommentMode = (
  value: string
): value is SeriesCommentMode =>
  SERIES_COMMENT_MODES.some((mode) => mode === value);
