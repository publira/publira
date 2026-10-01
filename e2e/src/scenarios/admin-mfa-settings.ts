/**
 * Records created by the admin MFA account settings E2E scenario. Re-applying
 * it drops the enrollment the suite made, so the account signs in on a
 * password alone again.
 */

export const ADMIN_MFA_SETTINGS_SCENARIO = "370_admin_mfa_settings";

/** Tenant admin of the seed tenant. Password hash is the same as `adminpass`. */
export const ADMIN_MFA_SETTINGS_ADMIN = {
  email: "mfa-settings-admin@example.com",
  name: "MFA Settings E2E Admin",
  password: "adminpass",
  publicId: "MfasADMNAAA1",
} as const;
