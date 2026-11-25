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
 * Editor of that tenant, added by `db/seeds/scenarios/860_docs_credit_shares.sql`
 * for the documentation's screenshots of what an Editor is shown of a share.
 * Password hash is the same as `adminpass`.
 */
export const ROYALTIES_EDITOR = {
  email: "royalty-editor@example.com",
  name: "Royalty E2E Editor",
  password: "adminpass",
  publicId: "RoyaEDTRAAA1",
} as const;

/**
 * The series and the episode of the scenario. The episode is credited 30% to
 * the artist and 20% to the writer, and `860_docs_credit_shares.sql` credits
 * the series to the writer at no share and to the artist at 30%.
 */
export const ROYALTIES_CATALOG = {
  episodePublicId: "RoyaEPSDAAA1",
  seriesPublicId: "RoyaSERSAAA1",
} as const;

/**
 * The month the scenario sells in: ten sales of a 500-yen episode credited 30%
 * to one author and 20% to another, and an eleventh sale refunded in full.
 * `gross` and `totalPayout` are the month's, the subscription payment below
 * included.
 */
export const ROYALTIES_SALES = {
  artist: "Royalty Artist",
  artistPayout: "¥1,500",
  gross: "¥5,980",
  period: "2026-01",
  periodLabel: "January 2026",
  totalPayout: "¥2,990",
  writer: "Royalty Writer",
  writerPayout: "¥1,000",
} as const;

/**
 * A 980-yen payment for a plan of the whole catalog, paid on the month's first
 * day for a period that ends in it, whose subscriber finished the episode: the
 * month shares all of it to that episode's two authors.
 */
export const ROYALTIES_SUBSCRIPTION = {
  amount: "¥980",
  artistShare: "¥294",
  artistSubtotal: "¥1,794",
  paidOn: "2026-01-01",
  periodEnd: "2026-01-31",
  writerShare: "¥196",
  writerSubtotal: "¥1,196",
} as const;
