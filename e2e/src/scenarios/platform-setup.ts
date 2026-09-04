/**
 * Constants for the initial-setup E2E.
 *
 * `/setup` renders only while `platform_users` is empty, so the spec empties it
 * (`emptyPlatformOperators()` in `../db.ts`) and creates the platform's first
 * operator through the form. `db/seeds/scenarios/110_platform_setup.sql` is
 * what puts the development seed's platform rows back afterwards, and it
 * removes the account below by the same address.
 */

export const PLATFORM_SETUP_SCENARIO = "110_platform_setup";

/**
 * The first operator the setup form creates. Deliberately not
 * `platform@example.com`: the address has to be one the restore file can delete
 * without touching the seeded super admin it re-inserts.
 */
export const SETUP_OPERATOR = {
  email: "setup-operator@example.com",
  name: "Setup E2E Operator",
  password: "setuppass",
} as const;

/**
 * The language chosen on the setup form.
 *
 * Playwright's Chromium asks for English, and the screen opens in it because
 * nothing has been saved yet, so picking Japanese is what separates the saved
 * platform default from the browser's preference on every screen afterwards. It
 * is also the value the development seed stores, so the restore file puts back
 * exactly what the form chose.
 */
export const SETUP_DEFAULT_LOCALE_LABEL = "日本語" as const;

export const SETUP_DEFAULT_LOCALE_CODE = "ja" as const;
