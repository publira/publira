/**
 * Records created by `db/seeds/scenarios/700_storefront_coins.sql`.
 * Re-applying it deletes both tenants and writes them again, which takes the
 * payment settings the suite stores, every grant and spend, and every
 * purchase with them.
 */

export const STOREFRONT_COINS_SCENARIO = "700_storefront_coins";

/** The coins tenant's id, which its cache tags are named by. */
export const STOREFRONT_COINS_TENANT_ID =
  "018f1710-0001-7000-8000-000000000001";

/** Tenant admin who takes the tenant's payments. Password hash is `adminpass`. */
export const STOREFRONT_COINS_ADMIN = {
  email: "coins-admin@example.com",
  name: "Coins E2E Admin",
  password: "adminpass",
  publicId: "CoinADMNAAA1",
} as const;

/** The reader who holds 100 Points. Password hash is `memberpass`. */
export const STOREFRONT_COINS_HOLDER = {
  email: "coins-holder@example.com",
  password: "memberpass",
} as const;

/** The reader who holds no Points. Password hash is `memberpass`. */
export const STOREFRONT_COINS_BUYER = {
  email: "coins-buyer@example.com",
  password: "memberpass",
} as const;

/** The tenant's word for its coins, per locale. */
export const STOREFRONT_COINS_NAME = { en: "Points", ja: "ポイント" } as const;

export const STOREFRONT_COINS_SERIES = {
  publicId: "CoinSERSAAA1",
  title: "Harbor Lights",
} as const;

/** 300 yen, 30 Points; the one the holder pays for. */
export const STOREFRONT_COINS_EPISODE = {
  publicId: "CoinEPSDAAA1",
  title: "The First Light",
} as const;

/** 300 yen, 30 Points; the one the buyer buys a pack for. */
export const STOREFRONT_COINS_OTHER_EPISODE = {
  publicId: "CoinEPSDAAA2",
  title: "The Second Light",
} as const;

/** The smallest pack that covers 30 Points: 50 Points for 500 yen. */
export const STOREFRONT_COINS_COVERING_PACK = {
  coins: 50,
  publicId: "CoinPACKAAA2",
} as const;

/** The issuer every pack is sold under. */
export const STOREFRONT_COINS_ISSUER = "Harbor Press Ltd.";

/** The tenant that saved its coin settings and left them off. */
export const STOREFRONT_COINS_OFF_READER = {
  email: "coins-off-reader@example.com",
  password: "memberpass",
} as const;

/** 300 yen, on the tenant whose coins are off. */
export const STOREFRONT_COINS_OFF_EPISODE = {
  publicId: "CoffEPSDAAA1",
  seriesPublicId: "CoffSERSAAA1",
} as const;
