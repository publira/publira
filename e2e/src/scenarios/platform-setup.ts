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
 * The language chosen on the setup form, and the code it is saved under.
 *
 * What this suite asserts about the choice is that `platform_config` holds it
 * afterwards, which it reads from the row rather than from a screen. That the
 * saved default then outranks the visitor's own `Accept-Language` is a separate
 * claim, and `platform.locale-switching.spec.ts` makes it directly: it saves a
 * language and opens the login screen in a fresh context with no cookie.
 *
 * So the form picks English, which is also what the development seed stores —
 * the restore file puts back exactly what the form chose — and every screen
 * this suite reads afterwards is in the same language as the rest of `e2e/`.
 */
export const SETUP_DEFAULT_LOCALE_LABEL = "English" as const;

export const SETUP_DEFAULT_LOCALE_CODE = "en" as const;
