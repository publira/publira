/**
 * Records created by `db/seeds/scenarios/640_reader_records.sql`.
 *
 * Two readers of the dev seed tenant: one holds a purchase and an access
 * ticket, and the other holds neither. Re-applying the scenario deletes both
 * readers' purchases and tickets, including the ones the suite issued, and
 * writes the seeded ones again.
 */

export const READER_RECORDS_SCENARIO = "640_reader_records";

/** The reader with a purchase and a ticket. */
export const READER_RECORDS_BUYER = {
  email: "reader-records-buyer@example.com",
  name: "Reader Records Buyer",
  publicId: "RrecMMBRAAA1",
} as const;

/** The reader with neither. */
export const READER_RECORDS_EMPTY = {
  email: "reader-records-empty@example.com",
  name: "Reader Records Empty",
  publicId: "RrecMMBRAAA2",
} as const;

/** The buyer's purchase. */
export const READER_RECORDS_PURCHASE = {
  episodeTitle: "Seed Episode 001-10",
  id: "018f1180-0002-7000-8000-000000000001",
} as const;

/** The buyer's ticket. */
export const READER_RECORDS_TICKET = {
  episodeTitle: "Seed Episode 001-02",
  note: "Reader records E2E: support case",
  publicId: "RrecTCKTAAA1",
} as const;
