/**
 * Records created by `db/seeds/scenarios/270_mobile_push.sql`. Re-applying it
 * deletes the tenant's stored Firebase credentials, which turns mobile push off.
 */

export const MOBILE_PUSH_SCENARIO = "270_mobile_push";

/** Tenant whose console the mobile push suite signs in on. */
export const MOBILE_PUSH_TENANT = {
  adminDomain: "admin.mobile-push.localhost",
  domain: "mobile-push.localhost",
  name: "Mobile Push Tenant",
  publicId: "MpshTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const MOBILE_PUSH_ADMIN = {
  email: "mobile-push-admin@example.com",
  name: "Mobile Push E2E Admin",
  password: "adminpass",
  publicId: "MpshADMNAAA1",
} as const;
