/**
 * Records created by `db/seeds/scenarios/070_member_settings.sql`.
 *
 * The suite rewrites this member's display name, notification preference, and
 * follow list, so it owns an account no other spec signs in as. Re-applying
 * the scenario is what puts those values back.
 */

export const MEMBER_SETTINGS_SCENARIO = "070_member_settings";

/** Member of the dev seed tenant. Password hash is the same as `memberpass`. */
export const MEMBER_SETTINGS_MEMBER = {
  email: "settings-member@example.com",
  name: "Settings E2E Member",
  password: "memberpass",
  publicId: "MsetMMBRAAA1",
} as const;

/** The address the security screen is asked to move the account to. */
export const MEMBER_SETTINGS_NEW_EMAIL = "settings-member-new@example.com";

/**
 * A published dev seed series no other spec follows, unfollows, or asserts a
 * listing position for.
 */
export const MEMBER_SETTINGS_SERIES = {
  publicId: "SeedSERSAA42",
  title: "Seed Series 042",
} as const;
