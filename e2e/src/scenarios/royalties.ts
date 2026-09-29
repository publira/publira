/**
 * Records created by `db/seeds/scenarios/260_royalties.sql`. Re-applying it
 * deletes the tenant and writes it again, which is the one way to remove a
 * closed statement.
 */

export const ROYALTIES_SCENARIO = "260_royalties";

/** Tenant whose console the royalties suite signs in on. */
export const ROYALTIES_TENANT = {
  adminDomain: "admin.royalty.localhost",
  domain: "royalty.localhost",
  name: "Royalty Tenant",
  publicId: "RoyaTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const ROYALTIES_ADMIN = {
  email: "royalty-admin@example.com",
  name: "Royalty E2E Admin",
  password: "adminpass",
  publicId: "RoyaADMNAAA1",
} as const;

/**
 * The month the scenario sells in: ten sales of a 500-yen episode credited 30%
 * to one author and 20% to another, and an eleventh sale refunded in full.
 */
export const ROYALTIES_SALES = {
  artist: "Royalty Artist",
  artistPayout: "¥1,500",
  gross: "¥5,000",
  period: "2026-01",
  periodLabel: "January 2026",
  totalPayout: "¥2,500",
  writer: "Royalty Writer",
  writerPayout: "¥1,000",
} as const;
