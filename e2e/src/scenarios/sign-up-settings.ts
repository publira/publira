/**
 * Records created by `db/seeds/scenarios/610_sign_up_settings.sql`.
 * Re-applying the file deletes the tenant and writes it again, which takes the
 * setting the suite saves.
 */

export const SIGN_UP_SETTINGS_SCENARIO = "610_sign_up_settings";

export const SIGN_UP_SETTINGS_TENANT = "ClsdTNNTAAA1";

/**
 * Tenant admin, who edits the setting. Password hash is the same as
 * `adminpass`.
 */
export const SIGN_UP_SETTINGS_ADMIN = {
  email: "sign-up-admin@example.com",
  name: "Sign-up Settings E2E Admin",
  password: "adminpass",
  publicId: "ClsdADMNAAA1",
} as const;

/**
 * Tenant editor, who reads the setting and cannot change it. Password hash is
 * the same as `adminpass`.
 */
export const SIGN_UP_SETTINGS_EDITOR = {
  email: "sign-up-editor@example.com",
  name: "Sign-up Settings E2E Editor",
  password: "adminpass",
  publicId: "ClsdEDTRAAA1",
} as const;
