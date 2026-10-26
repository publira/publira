/**
 * Records created by `db/seeds/scenarios/710_admin_coin_settings.sql`, and the
 * grant `711_admin_coin_settings_holder.sql` adds to them. Re-applying the
 * first deletes the tenant and writes it again, which takes its payment
 * settings, its coin settings, its packs, and the grant with it.
 */

export const ADMIN_COIN_SETTINGS_SCENARIO = "710_admin_coin_settings";

export const ADMIN_COIN_SETTINGS_HOLDER_SCENARIO =
  "711_admin_coin_settings_holder";

/** Tenant admin who sets the coins up. Password hash is `adminpass`. */
export const ADMIN_COIN_SETTINGS_ADMIN = {
  email: "coin-settings-admin@example.com",
  password: "adminpass",
} as const;

/** Tenant editor, whom the screen is not offered to. Password hash is `adminpass`. */
export const ADMIN_COIN_SETTINGS_EDITOR = {
  email: "coin-settings-editor@example.com",
  password: "adminpass",
} as const;

/** Tenant auditor, whom the screen is not offered to either. Password hash is `adminpass`. */
export const ADMIN_COIN_SETTINGS_AUDITOR = {
  email: "coin-settings-auditor@example.com",
  password: "adminpass",
} as const;

/** The reader the holder scenario grants 40 coins. Password hash is `memberpass`. */
export const ADMIN_COIN_SETTINGS_READER = {
  email: "coin-settings-reader@example.com",
  password: "memberpass",
} as const;
