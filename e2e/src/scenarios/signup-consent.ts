/**
 * Records created by `db/seeds/scenarios/300_signup_consent.sql`. Re-applying
 * the file deletes the tenant and writes it again, which takes the account the
 * suite signs up with it.
 */

export const SIGNUP_CONSENT_SCENARIO = "300_signup_consent";

/** The pages the tenant names, as the sign-up form links to them. */
export const SIGNUP_CONSENT_TERMS_PAGE = {
  path: "/terms",
  title: "Terms of service",
  /** The published version, not the superseded one before it. */
  versionId: "018f0ff0-0003-7000-8000-000000000002",
} as const;

export const SIGNUP_CONSENT_PRIVACY_PAGE = {
  path: "/privacy",
  title: "Privacy policy",
  versionId: "018f0ff0-0003-7000-8000-000000000003",
} as const;

/** The address the suite signs up. No account has it until the suite runs. */
export const SIGNUP_CONSENT_READER = {
  email: "consent-reader@example.com",
  name: "Consent E2E Reader",
  password: "consent-password",
} as const;
