/**
 * Records created by `db/seeds/scenarios/801_docs_webhooks.sql`: a tenant
 * with three API keys, an endpoint, and four deliveries written as literals,
 * for the documentation's screenshots.
 */

export const DOCS_WEBHOOKS_SCENARIO = "801_docs_webhooks";

/** Tenant whose keys and endpoint the documentation photographs. */
export const DOCS_WEBHOOKS_TENANT = {
  adminDomain: "admin.hook-docs.localhost",
  domain: "hook-docs.localhost",
  name: "Hook Docs Tenant",
  publicId: "DwhkTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const DOCS_WEBHOOKS_ADMIN = {
  email: "hook-docs-admin@example.com",
  name: "Hook Docs E2E Admin",
  password: "adminpass",
  publicId: "DwhkADMNAAA1",
} as const;

/** The endpoint's URL, which heads its part of the screen. */
export const DOCS_WEBHOOKS_ENDPOINT_URL =
  "https://crm.example.com/hooks/publira";
