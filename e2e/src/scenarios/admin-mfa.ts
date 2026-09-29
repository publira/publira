/**
 * Records created by the admin MFA E2E scenario. Re-applying it drops the
 * enrollment the suite made, so the account signs in on a password alone again.
 */

export const ADMIN_MFA_SCENARIO = "360_admin_mfa";

/** Tenant admin of the seed tenant. Password hash is the same as `adminpass`. */
export const ADMIN_MFA_ADMIN = {
  email: "mfa-admin@example.com",
  name: "MFA E2E Admin",
  password: "adminpass",
  publicId: "MfaEADMNAAA1",
} as const;
