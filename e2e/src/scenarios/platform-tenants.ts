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

/**
 * Scenario seed: the operator `platform.operator-management.spec.ts` promotes.
 *
 * Its own account rather than {@link SCENARIO_PLATFORM_OPERATOR}, because the
 * role-denial cases sign in as that one and need it left a plain operator.
 * Password reuses the same bcrypt hash as the super admin (`platformpass`).
 */
export const SCENARIO_ROLE_CHANGE_OPERATOR = {
  email: "platform-role-change@example.com",
  name: "Role Change Platform Operator",
  password: "platformpass",
  publicId: "ScenPFUSAAA3",
  role: "platform_operator",
} as const;

/**
 * Scenario seed: the operator `platform.operator-management.spec.ts`
 * deactivates, which is why it is not one another spec signs in as. Password
 * reuses the same bcrypt hash as the super admin (`platformpass`).
 */
export const SCENARIO_DEACTIVATED_OPERATOR = {
  email: "platform-deactivated@example.com",
  name: "Deactivated Platform Operator",
  password: "platformpass",
  publicId: "ScenPFUSAAA4",
  role: "platform_operator",
} as const;

export const PLATFORM_OPERATORS_SCENARIO = "030_platform_operators";

/** Unique run suffix so re-runs do not collide with leftover tenant names/domains. */
export const uniqueSuffix = (): string =>
  crypto.randomUUID().replaceAll("-", "").slice(0, 12);
