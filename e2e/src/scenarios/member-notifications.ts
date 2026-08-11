/**
 * Records created by `db/seeds/scenarios/020_member_notifications.sql`.
 *
 * Titles and counts are fixed in the seed SQL; keep them in sync with its
 * header comment.
 */
export const MEMBER_NOTIFICATIONS_SCENARIO = "020_member_notifications";

/** Dev seed member on Host `localhost` (db/seeds/README.md). */
export const SEED_MEMBER = {
  email: "member@example.com",
  password: "memberpass",
} as const;

export const MEMBER_NOTIFICATIONS = {
  /** Total rows the scenario seeds, i.e. three pages of 20 / 20 / 5. */
  count: 45,
  /** Newest row, so it heads the first page. */
  newestTitle: "Notice 045",
  /** Oldest row, so it ends the last page. */
  oldestTitle: "Notice 001",
} as const;
