/**
 * Records created by `db/seeds/scenarios/820_storefront_reader_mfa.sql` and
 * `821_docs_reader_mfa.sql`. Re-applying either file drops what was enrolled
 * for its reader, so the account signs in on its password alone again.
 */

export const STOREFRONT_READER_MFA_SCENARIO = "820_storefront_reader_mfa";

/** The reader `storefront.reader-mfa.spec.ts` enrolls and signs in as. */
export const READER_MFA_READER = {
  email: "reader-mfa@example.com",
  password: "memberpass",
  publicId: "MfaRMMBRAAA1",
} as const;

export const DOCS_READER_MFA_SCENARIO = "821_docs_reader_mfa";

/** The reader the documentation screenshots enroll. */
export const READER_MFA_DOCS_READER = {
  email: "reader-mfa-docs@example.com",
  password: "memberpass",
  publicId: "MfaRMMBRAAA2",
} as const;
