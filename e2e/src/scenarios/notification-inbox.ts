/**
 * Records created by `db/seeds/scenarios/060_notification_inbox.sql`.
 *
 * The bell's accessible name carries the unread count, and publishing an
 * episode notifies every member and every admin of that episode's tenant. The
 * empty-inbox specs therefore run on a tenant of their own, which owns no
 * series, instead of on the dev seed accounts `admin.publish-flow` delivers to.
 */

export const NOTIFICATION_INBOX_SCENARIO = "060_notification_inbox";

/**
 * The inbox tenant itself. A second tenant with users of its own is what lets
 * `platform.operator-management.spec.ts` tell a cross-tenant user list from one
 * that only ever shows the development seed tenant.
 */
export const NOTIFICATION_INBOX_TENANT = {
  name: "Notify Tenant",
  publicId: "NtfyTNNTAAA1",
} as const;

/** Tenant admin of the inbox tenant. Password hash is the same as `adminpass`. */
export const NOTIFICATION_INBOX_ADMIN = {
  email: "notify-admin@example.com",
  password: "adminpass",
  publicId: "NtfyADMNAAA1",
} as const;

/** Member of the inbox tenant. Password hash is the same as `memberpass`. */
export const NOTIFICATION_INBOX_MEMBER = {
  email: "notify-member@example.com",
  name: "Notify E2E Member",
  password: "memberpass",
  publicId: "NtfyMMBRAAA1",
} as const;
