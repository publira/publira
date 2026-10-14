/**
 * Records created by `db/seeds/scenarios/510_tenant_languages.sql`.
 * Re-applying it deletes the tenant and writes it again, which puts back the
 * languages it offered before the suite switched one of them.
 */

export const TENANT_LANGUAGES_SCENARIO = "510_tenant_languages";

/** The tenant admin that switches the languages. Password hash is `adminpass`. */
export const TENANT_LANGUAGES_ADMIN = {
  email: "langs-admin@example.com",
  password: "adminpass",
} as const;

/** The tenant's one page, translated into both of the languages it offers. */
export const TENANT_LANGUAGES_PAGE = {
  englishTitle: "About us",
  id: "018f10c0-0002-7000-8000-000000000001",
  japaneseTitle: "About us, in Japanese",
} as const;
