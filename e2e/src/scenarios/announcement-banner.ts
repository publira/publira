/**
 * Records created by `db/seeds/scenarios/200_announcement_banner.sql`.
 *
 * A pinned announcement is drawn above every page of its tenant's site, so the
 * banner spec pins into a tenant of its own rather than into the one
 * `180_announcement_delivery.sql` posts into.
 */

export const ANNOUNCEMENT_BANNER_SCENARIO = "200_announcement_banner";

/** The tenant every announcement this suite pins belongs to. */
export const ANNOUNCEMENT_BANNER_TENANT = {
  name: "Banner Tenant",
  publicId: "BnnrTNNTAAA1",
} as const;

/** Tenant admin that pins and unpins. Password hash is `adminpass`. */
export const ANNOUNCEMENT_BANNER_ADMIN = {
  email: "banner-admin@example.com",
  password: "adminpass",
  publicId: "BnnrADMNAAA1",
} as const;

/** Reader of the same tenant. Password hash is `memberpass`. */
export const ANNOUNCEMENT_BANNER_MEMBER = {
  email: "banner-member@example.com",
  name: "Banner E2E Member",
  password: "memberpass",
  publicId: "BnnrMMBRAAA1",
} as const;
