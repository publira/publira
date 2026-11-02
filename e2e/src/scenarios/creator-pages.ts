/**
 * Records created by `db/seeds/scenarios/730_creator_pages.sql`, which applies
 * `320_creator_reader.sql` first.
 *
 * The creator reader is linked to `Seed Author 001` and `Seed Author 002`, the
 * development seed tenant shows them their pages and sales, and November and
 * December 2025 are closed.
 */

export const CREATOR_PAGES_SCENARIO = "730_creator_pages";

/** The Authors the creator reader is linked to, oldest link first. */
export const CREATOR_PAGES_AUTHORS = [
  { id: "018f0e71-0001-7000-8000-000000000001", name: "Seed Author 001" },
  { id: "018f0e71-0002-7000-8000-000000000002", name: "Seed Author 002" },
] as const;

/**
 * The series of the other Authors December credits: `Seed Author 002`, whose
 * lines are on their own page, and `Seed Author 003`, whom the creator reader
 * is not linked to.
 */
export const CREATOR_PAGES_OTHER_AUTHORS_SERIES = [
  "Seed Series 002",
  "Seed Series 003",
] as const;

/**
 * December 2025 as `Seed Author 001` reads it: a line of the month's own sales
 * of `Seed Episode 001-10`, and an adjustment taking back a November sale of
 * it that was refunded in full.
 */
export const CREATOR_PAGES_DECEMBER = {
  adjustment: "Refund adjustment for November 2025",
  csvRows: [
    "2025-12,Original Author,SeedSERSAAA1,Seed Series 001,SeedEPSDAA1A,Seed Episode 001-10,6,3000,0,50.00,1500,JPY,,sale",
    "2025-12,Original Author,SeedSERSAAA1,Seed Series 001,SeedEPSDAA1A,Seed Episode 001-10,-1,-500,0,50.00,-250,JPY,2025-11,sale",
  ],
  fileName: "royalties-SeedAUTHAAA1-2025-12.csv",
  gross: "¥2,500",
  label: "December 2025",
  payout: "¥1,250",
  period: "2025-12",
  sales: "5",
} as const;
