/**
 * Records created by the platform operator two-step verification E2E scenario.
 * Re-applying it drops the enrollments the suites made and switches the
 * platform's requirement off, so both accounts sign in on a password alone
 * again.
 */

export const PLATFORM_MFA_SCENARIO = "490_platform_operator_mfa";

/** The operator the sign-in suite enrolls at the step the policy holds it at. */
export const PLATFORM_MFA_OPERATOR = {
  email: "mfa-operator@example.com",
  name: "MFA E2E Operator",
  password: "platformpass",
  publicId: "MfaoPFUSAAA1",
} as const;

/** The operator the account settings suite enrolls from `/account`. */
export const PLATFORM_MFA_SETTINGS_OPERATOR = {
  email: "mfa-settings-operator@example.com",
  name: "MFA Settings E2E Operator",
  password: "platformpass",
  publicId: "MfsoPFUSAAA1",
} as const;
