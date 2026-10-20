/**
 * Records created by `db/seeds/scenarios/520_purchases.sql`. Re-applying it
 * deletes the tenant and writes it again, which takes the payment settings the
 * suite stores with it.
 */

export const PURCHASES_SCENARIO = "520_purchases";

/** Tenant whose console the purchases suite signs in on. */
export const PURCHASES_TENANT = {
  adminDomain: "admin.purchases.localhost",
  domain: "purchases.localhost",
  name: "Purchases Tenant",
  publicId: "PrchTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const PURCHASES_ADMIN = {
  email: "purchases-admin@example.com",
  name: "Purchases E2E Admin",
  password: "adminpass",
  publicId: "PrchADMNAAA1",
} as const;

export const PURCHASES_SERIES = {
  publicId: "PrchSERSAAA1",
  title: "Purchase Series 001",
} as const;

export const PURCHASES_EPISODES = {
  first: { publicId: "PrchEPSDAAA1", title: "Purchase Episode 001-01" },
  second: { publicId: "PrchEPSDAAA2", title: "Purchase Episode 001-02" },
} as const;

export const PURCHASES_READERS = {
  one: { email: "purchase-buyer-one@example.com", name: "Purchase Buyer One" },
  two: { email: "purchase-buyer-two@example.com", name: "Purchase Buyer Two" },
} as const;

/**
 * The tenant's purchases, newest first: one paid through Stripe, one made in
 * the app through Google Play, and one paid through Stripe and refunded in
 * full in the Stripe Dashboard.
 */
export const PURCHASES = {
  googlePlay: {
    id: "018f10d0-0006-7000-8000-000000000002",
    purchasedOn: "2026-02-15",
  },
  refunded: {
    id: "018f10d0-0006-7000-8000-000000000003",
    purchasedOn: "2026-01-20",
  },
  stripe: {
    id: "018f10d0-0006-7000-8000-000000000001",
    /** The payment intent Stripe reported for it, and what was paid on it. */
    payment: { amount: 500, currency: "jpy", id: "pi_purchases_e2e_1" },
    purchasedOn: "2026-03-01",
  },
} as const;
