/**
 * Records created by `db/seeds/scenarios/630_staff_reader.sql`.
 *
 * Two readers of the dev seed tenant that hold no purchase or ticket: one
 * holds the tenant_editor role, which opens every published episode to it, and
 * the other holds nothing.
 */

export const STAFF_READER_SCENARIO = "630_staff_reader";

/** A tenant editor. Password hash is the same as `memberpass`. */
export const STAFF_READER_EDITOR = {
  email: "staff-reader-editor@example.com",
  password: "memberpass",
  publicId: "StfrEDTRAAA1",
} as const;

/** A reader with no grant, on the same password. */
export const STAFF_READER_MEMBER = {
  email: "staff-reader-member@example.com",
  password: "memberpass",
  publicId: "StfrMMBRAAA1",
} as const;
