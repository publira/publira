/**
 * Records created by `db/seeds/scenarios/650_subscription_plans.sql`.
 * Re-applying it deletes the tenant and writes it again, which takes the
 * payment settings and the plans the suite stores with it.
 */

export const SUBSCRIPTION_PLANS_SCENARIO = "650_subscription_plans";

/** Tenant admin of the tenant. Password hash is the same as `adminpass`. */
export const SUBSCRIPTION_PLANS_ADMIN = {
  email: "plans-admin@example.com",
  name: "Plans E2E Admin",
  password: "adminpass",
  publicId: "SubpADMNAAA1",
} as const;

export const SUBSCRIPTION_PLANS_LABEL = {
  name: "Plans Label 01",
  publicId: "SubpLABLAAA1",
} as const;

/**
 * The plan of the whole catalog the tenant's one reader already pays for, so
 * the console counts one subscriber and refuses to delete it.
 */
export const SUBSCRIPTION_PLANS_SEEDED_PLAN = {
  name: "Seeded monthly pass",
  publicId: "SubpPLANAAA1",
} as const;
