/**
 * Records created by `db/seeds/scenarios/800_paidy_checkout.sql`. Re-applying
 * it deletes the tenant and writes it again, which takes the payment settings
 * the suite stores and every sale with it.
 */

export const PAIDY_CHECKOUT_SCENARIO = "800_paidy_checkout";

export const PAIDY_CHECKOUT_TENANT = {
  adminDomain: "admin.paidy.localhost",
  domain: "paidy.localhost",
  name: "Paidy Tenant",
  publicId: "PidyTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const PAIDY_CHECKOUT_ADMIN = {
  email: "paidy-admin@example.com",
  name: "Paidy E2E Admin",
  password: "adminpass",
  publicId: "PidyADMNAAA1",
} as const;

/** Readers of that tenant. Password hash is the same as `memberpass`. */
export const PAIDY_CHECKOUT_READERS = {
  leaver: {
    email: "paidy-leaver@example.com",
    name: "Paidy Leaver",
    password: "memberpass",
    publicId: "PidyMMBRAAA2",
  },
  payer: {
    email: "paidy-payer@example.com",
    name: "Paidy Payer",
    password: "memberpass",
    publicId: "PidyMMBRAAA1",
  },
} as const;

export const PAIDY_CHECKOUT_SERIES = {
  publicId: "PidySERSAAA1",
  title: "Paidy Series 001",
} as const;

/** 500 yen, with three pages. */
export const PAIDY_CHECKOUT_EPISODE = {
  publicId: "PidyEPSDAAA1",
  title: "Paidy Episode 001-01",
} as const;

export const PAIDY_CHECKOUT_EPISODE_PATH = `/series/${PAIDY_CHECKOUT_SERIES.publicId}/episodes/${PAIDY_CHECKOUT_EPISODE.publicId}`;
