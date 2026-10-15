/**
 * Records created by the admin MFA E2E scenario. Re-applying it drops the
 * enrollments the suite made, so the accounts sign in on a password alone again.
 */

export const ADMIN_MFA_SCENARIO = "360_admin_mfa";

/** Tenant admin of the seed tenant. Password hash is the same as `adminpass`. */
export const ADMIN_MFA_ADMIN = {
  email: "mfa-admin@example.com",
  name: "MFA E2E Admin",
  password: "adminpass",
  publicId: "MfaEADMNAAA1",
} as const;

/**
 * Tenant admin of the seed tenant who enrolls a passkey rather than an
 * authenticator app. Password hash is the same as `adminpass`.
 */
export const ADMIN_PASSKEY_ADMIN = {
  email: "mfa-passkey-admin@example.com",
  name: "MFA Passkey E2E Admin",
  password: "adminpass",
  publicId: "MfaPADMNAAA1",
} as const;
