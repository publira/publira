/**
 * Records created by `db/seeds/scenarios/060_notification_inbox.sql` (#1380).
 *
 * The bell's accessible name carries the unread count, and publishing an
 * episode notifies every member and every admin of that episode's tenant. The
 * empty-inbox specs therefore run on a tenant of their own, which owns no
 * series, instead of on the dev seed accounts `admin.publish-flow` delivers to.
 */

export const NOTIFICATION_INBOX_SCENARIO = "060_notification_inbox";

/** Tenant admin of the inbox tenant. Password hash is the same as `adminpass`. */
export const NOTIFICATION_INBOX_ADMIN = {
  email: "notify-admin@example.com",
  password: "adminpass",
  publicId: "NtfyADMNAAA1",
} as const;

/** Member of the inbox tenant. Password hash is the same as `memberpass`. */
export const NOTIFICATION_INBOX_MEMBER = {
  email: "notify-member@example.com",
  password: "memberpass",
  publicId: "NtfyMMBRAAA1",
} as const;
