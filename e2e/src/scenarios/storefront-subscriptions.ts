/**
 * Records created by `db/seeds/scenarios/670_storefront_subscriptions.sql`.
 * Re-applying it deletes the tenant and writes it again, which takes the
 * payment settings the suite stores and the reader's subscription with it.
 */

export const STOREFRONT_SUBSCRIPTIONS_SCENARIO = "670_storefront_subscriptions";

/** Tenant admin who takes the tenant's payments. Password hash is `adminpass`. */
export const STOREFRONT_SUBSCRIPTIONS_ADMIN = {
  email: "subs-admin@example.com",
  name: "Subscriptions E2E Admin",
  password: "adminpass",
  publicId: "SbsfADMNAAA1",
} as const;

/** The reader, who holds nothing yet. Password hash is `memberpass`. */
export const STOREFRONT_SUBSCRIPTIONS_READER = {
  email: "subs-reader@example.com",
  password: "memberpass",
} as const;

export const STOREFRONT_SUBSCRIPTIONS_LABEL = {
  name: "Night Label",
  publicId: "SbsfLABLAAA1",
} as const;

/** The plan's one series, under {@link STOREFRONT_SUBSCRIPTIONS_LABEL}. */
export const STOREFRONT_SUBSCRIPTIONS_SERIES = {
  publicId: "SbsfSERSAAA1",
  title: "Night Series 001",
} as const;

/** 300 yen, and opened by the plan. */
export const STOREFRONT_SUBSCRIPTIONS_EPISODE = {
  publicId: "SbsfEPSDAAA1",
  title: "Night Episode 001-01",
} as const;

/** 300 yen, in a series under no label, which the plan does not open. */
export const STOREFRONT_SUBSCRIPTIONS_OTHER_EPISODE = {
  publicId: "SbsfEPSDAAA2",
  seriesPublicId: "SbsfSERSAAA2",
} as const;

/** The plan of the label, 980 yen a month. */
export const STOREFRONT_SUBSCRIPTIONS_PLAN = {
  name: "Night pass",
  publicId: "SbsfPLANAAA1",
} as const;
