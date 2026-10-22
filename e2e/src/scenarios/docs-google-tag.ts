/**
 * Records created by `db/seeds/scenarios/600_docs_google_tag.sql`: a tenant
 * whose Google tag is saved in the gateway mode with a gateway path written as
 * a literal, for the documentation's screenshots.
 */

export const DOCS_GOOGLE_TAG_SCENARIO = "600_docs_google_tag";

/** Tenant whose Google tag the documentation photographs. */
export const DOCS_GOOGLE_TAG_TENANT = {
  adminDomain: "admin.tag-docs.localhost",
  domain: "tag-docs.localhost",
  name: "Tag Docs Tenant",
  publicId: "DtagTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const DOCS_GOOGLE_TAG_ADMIN = {
  email: "tag-docs-admin@example.com",
  name: "Tag Docs E2E Admin",
  password: "adminpass",
  publicId: "DtagADMNAAA1",
} as const;
