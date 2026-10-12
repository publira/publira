/**
 * Records created by `db/seeds/scenarios/500_legal_page_agreement.sql`.
 * Re-applying it deletes the tenant and writes it again, which takes the
 * request the suite publishes and the reader's agreement to it.
 */

export const LEGAL_PAGE_AGREEMENT_SCENARIO = "500_legal_page_agreement";

export const LEGAL_PAGE_AGREEMENT_TENANT = "AgreTNNTAAA1";

/** The tenant admin that publishes the revision. Password hash is `adminpass`. */
export const LEGAL_PAGE_AGREEMENT_ADMIN = {
  email: "agree-admin@example.com",
  password: "adminpass",
} as const;

/**
 * The reader who agreed to the published version of both pages when the
 * account was opened. Password hash is `memberpass`.
 */
export const LEGAL_PAGE_AGREEMENT_READER = {
  email: "agree-member@example.com",
  password: "memberpass",
} as const;

/** The terms of service: `v1` is published and agreed to, `v2` a draft. */
export const LEGAL_PAGE_AGREEMENT_TERMS_PAGE = {
  id: "018f10b0-0002-7000-8000-000000000001",
  path: "/terms",
  revisedVersionId: "018f10b0-0003-7000-8000-000000000002",
  title: "Terms of service",
} as const;

/** The privacy policy, whose one version the reader agreed to. */
export const LEGAL_PAGE_AGREEMENT_PRIVACY_PAGE = {
  path: "/privacy",
  title: "Privacy policy",
} as const;
