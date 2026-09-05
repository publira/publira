/**
 * Records created by the operator-settings E2E scenarios.
 *
 * Each suite owns the account it rewrites — the admin on
 * `130_admin_operator_settings.sql`, the platform operator on
 * `131_platform_operator_settings.sql` — so a display of the address, a
 * confirmation token, or a leftover SMTP field cannot collide with a spec
 * that signs in as a seed operator. Re-applying the scenario is what puts
 * the starting values back.
 */

export const ADMIN_OPERATOR_SETTINGS_SCENARIO = "130_admin_operator_settings";
export const PLATFORM_OPERATOR_SETTINGS_SCENARIO =
  "131_platform_operator_settings";

/** Tenant whose console the admin operator-settings suite signs in on. */
export const ADMIN_OPERATOR_SETTINGS_TENANT = {
  adminDomain: "admin.aset.localhost",
  domain: "aset.localhost",
  name: "Operator Settings Tenant",
  publicId: "AsetTNNTAAA1",
} as const;

/**
 * Tenant admin of that tenant. Password hash is the same as `adminpass`.
 *
 * The suite moves this account to {@link ADMIN_OPERATOR_SETTINGS_NEW_EMAIL}
 * and signs in with it, which no account another suite authenticates as can
 * absorb.
 */
export const ADMIN_OPERATOR_SETTINGS_ADMIN = {
  email: "aset-admin@example.com",
  name: "Operator Settings E2E Admin",
  password: "adminpass",
  publicId: "AsetADMNAAA1",
} as const;

/** The address the admin account is moved to, and signs in with afterwards. */
export const ADMIN_OPERATOR_SETTINGS_NEW_EMAIL = "aset-admin-new@example.com";

/**
 * The address of a request whose token is expired before its link is opened.
 * The expired link is read from the message sent here, so it never has to be
 * told apart from the round trip's own mail.
 */
export const ADMIN_OPERATOR_SETTINGS_EXPIRED_EMAIL =
  "aset-admin-expired@example.com";

/** Sender name the admin SMTP save writes, then the scenario puts back. */
export const ADMIN_OPERATOR_SETTINGS_FROM_NAME =
  "Renamed Operator Settings Mail";

/**
 * Platform operator. Password hash is the same as `platformpass`.
 *
 * The suite moves this account to {@link PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL}
 * and signs in with it. It is a plain operator rather than a super admin: the
 * account and email screens do not require that role, and the SMTP save is
 * allowed for an operator.
 */
export const PLATFORM_OPERATOR_SETTINGS_OPERATOR = {
  email: "aset-platform@example.com",
  name: "Operator Settings E2E Operator",
  password: "platformpass",
  publicId: "AsetPFUSAAA1",
} as const;

/** The address the platform account is moved to, and signs in with afterwards. */
export const PLATFORM_OPERATOR_SETTINGS_NEW_EMAIL =
  "aset-platform-new@example.com";

/**
 * The address of a request whose token is expired before its link is opened,
 * the same split as {@link ADMIN_OPERATOR_SETTINGS_EXPIRED_EMAIL}.
 */
export const PLATFORM_OPERATOR_SETTINGS_EXPIRED_EMAIL =
  "aset-platform-expired@example.com";

/**
 * Reply-to the platform SMTP save writes. The scenario restores the
 * development seed's `support@platform.local`.
 */
export const PLATFORM_OPERATOR_SETTINGS_REPLY_TO =
  "aset-platform-reply@example.com";

export const PLATFORM_SMTP_SEED_REPLY_TO = "support@platform.local";
