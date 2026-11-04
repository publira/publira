/**
 * Records created by `db/seeds/scenarios/790_promotion_codes.sql`. Re-applying
 * it deletes the tenant and writes it again, with every code a suite created.
 */

export const PROMOTION_CODES_SCENARIO = "790_promotion_codes";

/** Tenant whose console the promotion codes suite signs in on. */
export const PROMOTION_CODES_TENANT = {
  adminDomain: "admin.promo.localhost",
  domain: "promo.localhost",
  name: "Promotion Codes Tenant",
  publicId: "PrmoTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const PROMOTION_CODES_ADMIN = {
  email: "promo-admin@example.com",
  name: "Promotion Codes E2E Admin",
  password: "adminpass",
  publicId: "PrmoADMNAAA1",
} as const;

/** Tenant editor of that tenant, who is not offered the screen. */
export const PROMOTION_CODES_EDITOR = {
  email: "promo-editor@example.com",
  name: "Promotion Codes E2E Editor",
  password: "adminpass",
  publicId: "PrmoEDTRAAA1",
} as const;

export const PROMOTION_CODES_READER = {
  email: "promo-buyer@example.com",
  name: "Promo Buyer",
} as const;

export const PROMOTION_CODES_SERIES = {
  publicId: "PrmoSERSAAA1",
  title: "Promotion Series 001",
} as const;

export const PROMOTION_CODES_EPISODE = {
  publicId: "PrmoEPSDAAA1",
  title: "Promotion Episode 001-01",
} as const;

/**
 * The seeded codes: WELCOME10, which the reader redeemed on a 500-yen episode
 * and paid 450 for, and SPRING100, which no purchase has used.
 */
export const PROMOTION_CODES = {
  spring: { code: "SPRING100", id: "018f1770-0009-7000-8000-000000000002" },
  welcome: {
    code: "WELCOME10",
    id: "018f1770-0009-7000-8000-000000000001",
    purchaseId: "018f1770-0006-7000-8000-000000000001",
  },
} as const;
