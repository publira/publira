/**
 * Constants for the platform tenant-ops E2E.
 *
 * Super-admin credentials match `db/seeds/README.md` /
 * `db/seeds/dev/001_tenant_users.sql`. The limited operator comes from
 * `db/seeds/scenarios/030_platform_operators.sql`.
 */

/** Dev seed platform super admin (Host `platform.localhost`). */
export const SEED_PLATFORM_SUPER_ADMIN = {
  email: "platform@example.com",
  name: "Platform Operator",
  password: "platformpass",
  publicId: "SeedPFUSAAA1",
  role: "platform_super_admin",
} as const;

/**
 * Scenario seed: active platform_operator (not super admin).
 * Password reuses the same bcrypt hash as the super admin (`platformpass`).
 */
export const SCENARIO_PLATFORM_OPERATOR = {
  email: "platform-operator@example.com",
  name: "Limited Platform Operator",
  password: "platformpass",
  publicId: "ScenPFUSAAA1",
  role: "platform_operator",
} as const;

export const PLATFORM_OPERATORS_SCENARIO = "030_platform_operators";

/** Unique run suffix so re-runs do not collide with leftover tenant names/domains. */
export const uniqueSuffix = (): string =>
  crypto.randomUUID().replaceAll("-", "").slice(0, 12);
