/**
 * Records created by `db/seeds/scenarios/530_storefront_passkey.sql`.
 * Re-applying the file drops the passkeys the suite registered.
 */

export const STOREFRONT_PASSKEY_SCENARIO = "530_storefront_passkey";

/** A reader of the development seed tenant no other suite signs in as. */
export const STOREFRONT_PASSKEY_READER = {
  email: "passkey-reader@example.com",
  password: "memberpass",
  publicId: "PskyMMBRAAA1",
} as const;
