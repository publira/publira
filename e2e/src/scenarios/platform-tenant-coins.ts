/**
 * Records created by the tenant coin allowance E2E scenario. Re-applying it
 * switches the allowance off again.
 */

export const PLATFORM_TENANT_COINS_SCENARIO = "660_platform_tenant_coins";

/** The Operator the suite turns the allowance on and off as. */
export const PLATFORM_TENANT_COINS_OPERATOR = {
  email: "coins-operator@example.com",
  name: "Coins E2E Operator",
  password: "platformpass",
  publicId: "TcnsPFUSAAA1",
} as const;

/** The Auditor whose save of the same page is refused. */
export const PLATFORM_TENANT_COINS_AUDITOR = {
  email: "coins-auditor@example.com",
  name: "Coins E2E Auditor",
  password: "platformpass",
  publicId: "TcnsPFUSAAA2",
} as const;
