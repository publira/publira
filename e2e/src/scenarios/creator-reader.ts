/**
 * Records created by `db/seeds/scenarios/320_creator_reader.sql`.
 *
 * A reader account linked to `Seed Author 001`, so the episodes of
 * `Seed Series 001` are its own. It holds no purchase or ticket.
 */

export const CREATOR_READER_SCENARIO = "320_creator_reader";

/** Member of the dev seed tenant. Password hash is the same as `memberpass`. */
export const CREATOR_READER = {
  email: "creator-reader@example.com",
  password: "memberpass",
  publicId: "CrdrMMBRAAA1",
} as const;
