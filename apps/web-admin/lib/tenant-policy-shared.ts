/**
 * Limit shapes and server-enforced bounds, in their own module because the
 * forms are Client Components: importing one from `tenant-community-limits.ts`
 * would pull the API client into the browser bundle.
 */

/** A limit written as a burst per minute and a ceiling per day. */
export interface MinuteDayLimit {
  perDay: number;
  perMinute: number;
}

/** A limit written as a burst per hour and a ceiling per day. */
export interface HourDayLimit {
  perDay: number;
  perHour: number;
}

/** The largest limit the API can carry (`int32`); the platform value binds first. */
export const MAX_COMMUNITY_LIMIT = 2_147_483_647;

/** Mirrors `platformpolicy.MaxDuplicateCommentWindow` (one week). */
export const MAX_DUPLICATE_COMMENT_WINDOW_MINUTES = 10_080;

/** Mirrors `retention.MaxDays`. */
export const MAX_RETENTION_DAYS = 36_500;

/** The shortest period or limit a tenant may save. */
export const MIN_POLICY_VALUE = 1;
