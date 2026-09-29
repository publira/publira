/**
 * Records created by `db/seeds/scenarios/210_reader_moderation.sql`.
 *
 * The suite suspends one of these readers and deletes the other, so it owns
 * accounts no other spec signs in as. Re-applying the scenario is what makes
 * the first active again and re-creates the second.
 */

export const READER_MODERATION_SCENARIO = "210_reader_moderation";

/** The reader the suite suspends and then lets back in. */
export const READER_MODERATION_SUSPEND = {
  email: "reader-moderation-suspend@example.com",
  name: "Reader Moderation E2E Suspend",
  publicId: "RmodMMBRAAA1",
} as const;

/** The reader the suite deletes. */
export const READER_MODERATION_DELETE = {
  email: "reader-moderation-delete@example.com",
  name: "Reader Moderation E2E Delete",
  publicId: "RmodMMBRAAA2",
} as const;
