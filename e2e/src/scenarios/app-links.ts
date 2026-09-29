/**
 * Records created by `db/seeds/scenarios/280_app_links.sql`. Re-applying it
 * deletes the tenant's config row, which leaves it with no app on either
 * platform.
 */

export const APP_LINKS_SCENARIO = "280_app_links";

/** Tenant whose console the app links suite signs in on. */
export const APP_LINKS_TENANT = {
  adminDomain: "admin.app-links.localhost",
  domain: "app-links.localhost",
  name: "App Links Tenant",
  publicId: "AplnTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const APP_LINKS_ADMIN = {
  email: "app-links-admin@example.com",
  name: "App Links E2E Admin",
  password: "adminpass",
  publicId: "AplnADMNAAA1",
} as const;
