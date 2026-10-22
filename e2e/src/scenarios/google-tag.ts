/**
 * Records created by `db/seeds/scenarios/570_google_tag.sql`. Re-applying it
 * deletes the tenant's stored Google tag settings, which leaves it loading no
 * tag.
 */

export const GOOGLE_TAG_SCENARIO = "570_google_tag";

/** Tenant whose console the Google tag suite signs in on. */
export const GOOGLE_TAG_TENANT = {
  adminDomain: "admin.google-tag.localhost",
  domain: "google-tag.localhost",
  name: "Google Tag Tenant",
  publicId: "GtagTNNTAAA1",
} as const;

/** Tenant admin of that tenant. Password hash is the same as `adminpass`. */
export const GOOGLE_TAG_ADMIN = {
  email: "google-tag-admin@example.com",
  name: "Google Tag E2E Admin",
  password: "adminpass",
  publicId: "GtagADMNAAA1",
} as const;
