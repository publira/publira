/**
 * Records created by `db/seeds/scenarios/180_announcement_delivery.sql`.
 *
 * Posting an announcement raises the unread notification count of every reader
 * it addresses, so the delivery spec posts into a tenant of its own instead of
 * into the one `060_notification_inbox.sql` keeps empty for the bell specs.
 */

export const ANNOUNCEMENT_DELIVERY_SCENARIO = "180_announcement_delivery";

/** The tenant every announcement this suite posts is delivered inside. */
export const ANNOUNCEMENT_DELIVERY_TENANT = {
  name: "Announce Tenant",
  publicId: "AncmTNNTAAA1",
} as const;

/** Tenant admin that posts the announcements. Password hash is `adminpass`. */
export const ANNOUNCEMENT_DELIVERY_ADMIN = {
  email: "announce-admin@example.com",
  password: "adminpass",
  publicId: "AncmADMNAAA1",
} as const;

/**
 * The recipient a targeted announcement names. A second tenant admin rather
 * than a second reader, because the console's audience picker offers the
 * tenant's staff.
 */
export const ANNOUNCEMENT_DELIVERY_TARGET = {
  email: "announce-target@example.com",
  name: "Announce E2E Target",
  password: "adminpass",
  publicId: "AncmTRGTAAA1",
} as const;

/** Reader of the same tenant. Password hash is `memberpass`. */
export const ANNOUNCEMENT_DELIVERY_MEMBER = {
  email: "announce-member@example.com",
  name: "Announce E2E Member",
  password: "memberpass",
  publicId: "AncmMMBRAAA1",
} as const;
