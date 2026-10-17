/**
 * Records created by `db/seeds/scenarios/540_storefront_passkey_settings.sql`.
 * Re-applying the file drops the passkeys the suite registered and brings back
 * the account it deleted.
 */

export const STOREFRONT_PASSKEY_SETTINGS_SCENARIO =
  "540_storefront_passkey_settings";

/** A reader of the development seed tenant no other suite signs in as. */
export const PASSKEY_SETTINGS_READER = {
  email: "passkey-settings@example.com",
  password: "memberpass",
  publicId: "PkstMMBRAAA1",
} as const;

/**
 * A reader of the development seed tenant with neither a password nor a
 * linked provider. Nothing signs it in until the suite adds a passkey, so the
 * suite plants its session.
 */
export const PASSWORDLESS_PASSKEY_READER = {
  email: "passkey-passwordless@example.com",
  publicId: "PkstMMBRAAA2",
} as const;
