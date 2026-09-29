/**
 * Records created by `db/seeds/scenarios/340_sign_in_providers.sql`.
 * Re-applying it deletes both providers' settings, which leaves the tenant
 * with neither.
 */

export const SIGN_IN_PROVIDERS_SCENARIO = "340_sign_in_providers";

/** Tenant whose console the sign-in providers suite signs in on. */
export const SIGN_IN_PROVIDERS_TENANT = {
  adminDomain: "admin.sign-in.localhost",
  domain: "sign-in.localhost",
  /** The iOS app the scenario names under App links. */
  iosBundleIdentifier: "com.example.reader",
  name: "Sign-in Providers Tenant",
  publicId: "SgnnTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const SIGN_IN_PROVIDERS_ADMIN = {
  email: "sign-in-admin@example.com",
  name: "Sign-in Providers E2E Admin",
  password: "adminpass",
  publicId: "SgnnADMNAAA1",
} as const;
