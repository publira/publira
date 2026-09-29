/**
 * Records created by `db/seeds/scenarios/350_social_sign_in.sql`. Re-applying
 * the file deletes the tenants and writes them again, which takes the accounts
 * and the links the suite creates.
 */

export const SOCIAL_SIGN_IN_SCENARIO = "350_social_sign_in";

/** The client ID both tenants sign readers in with Google through. */
export const SOCIAL_SIGN_IN_GOOGLE_CLIENT_ID =
  "123456789012-e2esocial.apps.googleusercontent.com";

/** The tenant that offers Apple and Google. */
export const SOCIAL_SIGN_IN_TENANT = "SoclTNNTAAA1";

/** The tenant that offers Google and names a terms page. */
export const SOCIAL_SIGN_IN_CONSENT_TENANT = "SoclTNNTAAA2";

/** The consent tenant's terms page, as the consent screen links to it. */
export const SOCIAL_SIGN_IN_TERMS_PAGE = {
  title: "Terms of service",
  versionId: "018f1050-0005-7000-8000-000000000001",
} as const;

/** A member of the first tenant who signs in with a password. */
export const SOCIAL_SIGN_IN_MEMBER = {
  email: "social-member@example.com",
  name: "Social Sign-in E2E Member",
  password: "memberpass",
  publicId: "SoclMMBRAAA1",
} as const;
