/**
 * Records created by `db/seeds/scenarios/620_site_verification.sql`.
 * Re-applying the file deletes the tenant and writes it again, which takes the
 * codes the suite saves.
 */

export const SITE_VERIFICATION_SCENARIO = "620_site_verification";

export const SITE_VERIFICATION_TENANT = {
  id: "018f1160-0001-7000-8000-000000000001",
  publicId: "VrfyTNNTAAA1",
} as const;

/**
 * Tenant admin, who edits the codes. Password hash is the same as
 * `adminpass`.
 */
export const SITE_VERIFICATION_ADMIN = {
  email: "verify-admin@example.com",
  name: "Site Verification E2E Admin",
  password: "adminpass",
  publicId: "VrfyADMNAAA1",
} as const;

/**
 * Tenant editor, whom the API does not answer the codes to. Password hash is
 * the same as `adminpass`.
 */
export const SITE_VERIFICATION_EDITOR = {
  email: "verify-editor@example.com",
  name: "Site Verification E2E Editor",
  password: "adminpass",
  publicId: "VrfyEDTRAAA1",
} as const;
