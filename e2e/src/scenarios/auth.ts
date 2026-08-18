/**
 * Constants for the auth / session-expiry E2E (#67).
 *
 * Seed accounts match `db/seeds/README.md`. Dedicated scenario accounts
 * (`040_auth_e2e.sql`) exist so a credentials_version bump cannot invalidate
 * a session another spec is still using.
 */

export { SEED_ADMIN } from "./admin-publish";
export { SEED_MEMBER } from "./member-announcements";
export { SEED_PLATFORM_SUPER_ADMIN } from "./platform-tenants";

export const AUTH_E2E_SCENARIO = "040_auth_e2e";

/** Dev seed tenant primary key — the JWT `tid` claim, not the public_id. */
export const SEED_TENANT_ID = "018f0e6a-1000-7000-8000-000000000001";

export const SEED_ADMIN_PUBLIC_ID = "SeedADMNAAA1";
export const SEED_MEMBER_PUBLIC_ID = "SeedMMBRAAA1";

/** Isolated tenant admin. Password hash is the same as `adminpass`. */
export const SCENARIO_AUTH_ADMIN = {
  email: "auth-admin@example.com",
  password: "adminpass",
  publicId: "ScenADMNAAA1",
} as const;

/** Isolated member. Password hash is the same as `memberpass`. */
export const SCENARIO_AUTH_MEMBER = {
  email: "auth-member@example.com",
  password: "memberpass",
  publicId: "ScenMMBRAAA1",
} as const;

/** Isolated platform super admin. Password hash is the same as `platformpass`. */
export const SCENARIO_AUTH_PLATFORM = {
  email: "auth-platform@example.com",
  password: "platformpass",
  publicId: "ScenPFUSAAA2",
} as const;
