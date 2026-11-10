/**
 * Records created by `db/seeds/scenarios/800_webhooks.sql`. Re-applying it
 * deletes the tenant's API keys, webhook endpoints, deliveries, and audit log
 * entries.
 */

export const WEBHOOKS_SCENARIO = "800_webhooks";

/** Tenant whose console the API keys and webhooks suite signs in on. */
export const WEBHOOKS_TENANT = {
  adminDomain: "admin.webhooks.localhost",
  domain: "webhooks.localhost",
  name: "Webhooks Tenant",
  publicId: "WhokTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const WEBHOOKS_ADMIN = {
  email: "webhooks-admin@example.com",
  name: "Webhooks E2E Admin",
  password: "adminpass",
  publicId: "WhokADMNAAA1",
} as const;

/**
 * A reader of that tenant, holding no role, whose comments the suite posts
 * with a token it mints for them.
 */
export const WEBHOOKS_READER = {
  email: "webhooks-reader@example.com",
  name: "Webhooks E2E Reader",
  publicId: "WhokMMBRAAA1",
} as const;

/** Tenant editor of that tenant, who is not shown the page. */
export const WEBHOOKS_EDITOR = {
  email: "webhooks-editor@example.com",
  name: "Webhooks E2E Editor",
  password: "adminpass",
  publicId: "WhokEDTRAAA1",
} as const;
