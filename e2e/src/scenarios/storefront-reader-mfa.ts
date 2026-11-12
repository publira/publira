/**
 * Records created by `db/seeds/scenarios/820_storefront_reader_mfa.sql`,
 * `821_docs_reader_mfa.sql`, and `822_docs_console_reader_mfa.sql`.
 * Re-applying either of the first two drops what was enrolled for its reader,
 * so the account signs in on its password alone again; the third leaves its
 * reader with two-step verification on.
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

export const DOCS_CONSOLE_READER_MFA_SCENARIO = "822_docs_console_reader_mfa";

/**
 * The reader whose two-step verification the console's documentation shows
 * on, and photographs the removal of without confirming it.
 */
export const READER_MFA_CONSOLE_DOCS_READER = {
  name: "Sample Two-step Reader",
  publicId: "MfaRMMBRAAA3",
} as const;
