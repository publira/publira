/**
 * Records created by `db/seeds/scenarios/590_crawler_settings.sql`.
 * Re-applying the file deletes the tenant and writes it again, which takes the
 * setting the suite saves.
 */

export const CRAWLER_SETTINGS_SCENARIO = "590_crawler_settings";

export const CRAWLER_SETTINGS_TENANT = "CrwlTNNTAAA1";

/**
 * Tenant admin, who edits the setting. Password hash is the same as
 * `adminpass`.
 */
export const CRAWLER_SETTINGS_ADMIN = {
  email: "crawlers-admin@example.com",
  name: "Crawler Settings E2E Admin",
  password: "adminpass",
  publicId: "CrwlADMNAAA1",
} as const;

/**
 * Tenant editor, who reads the setting and cannot change it. Password hash is
 * the same as `adminpass`.
 */
export const CRAWLER_SETTINGS_EDITOR = {
  email: "crawlers-editor@example.com",
  name: "Crawler Settings E2E Editor",
  password: "adminpass",
  publicId: "CrwlEDTRAAA1",
} as const;
