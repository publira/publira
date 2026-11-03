/**
 * Records created by `db/seeds/scenarios/770_targeted_announcements.sql`.
 *
 * A targeted announcement is listed and opened only by the readers it was
 * delivered to, so the spec that reads one reads it in a tenant of its own,
 * where one reader holds its notification and the other does not.
 */

export const TARGETED_ANNOUNCEMENTS_SCENARIO = "770_targeted_announcements";

/** The reader the targeted announcement was delivered to. Password hash is `memberpass`. */
export const TARGETED_ANNOUNCEMENTS_READER = {
  email: "targeted-reader@example.com",
  name: "Targeted E2E Reader",
  password: "memberpass",
  publicId: "TrgtRDERAAA1",
} as const;

/** A reader of the same tenant it was not delivered to. Password hash is `memberpass`. */
export const TARGETED_ANNOUNCEMENTS_OTHER_READER = {
  email: "targeted-other@example.com",
  name: "Targeted E2E Other",
  password: "memberpass",
  publicId: "TrgtOTHRAAA1",
} as const;

/** The announcements of the tenant, listed newest first. */
export const TARGETED_ANNOUNCEMENTS = {
  /** For everyone, delivered last. */
  newer: {
    id: "018f1ab0-0001-7000-8000-000000000023",
    title: "Targeted E2E Newer Notice",
  },
  /** For everyone, delivered first. */
  older: {
    id: "018f1ab0-0001-7000-8000-000000000021",
    title: "Targeted E2E Older Notice",
  },
  /** For the readers who signed up in the last 30 days: the reader alone. */
  targeted: {
    body: "An announcement for the readers who signed up in the last 30 days.",
    id: "018f1ab0-0001-7000-8000-000000000022",
    title: "Targeted E2E Notice for New Readers",
  },
} as const;
