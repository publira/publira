/**
 * Records created by `db/seeds/scenarios/760_announcement_audience.sql`.
 *
 * A targeted announcement notifies the readers its conditions select, so the
 * audience spec posts into a tenant of its own, where two readers are told
 * apart by whether they follow its one series and by the plan they hold.
 */

export const ANNOUNCEMENT_AUDIENCE_SCENARIO = "760_announcement_audience";

/** The tenant every announcement this suite posts is delivered inside. */
export const ANNOUNCEMENT_AUDIENCE_TENANT = {
  name: "Audience Tenant",
  publicId: "AudcTNNTAAA1",
} as const;

/** The tenant editor who posts the announcements. Password hash is `adminpass`. */
export const ANNOUNCEMENT_AUDIENCE_EDITOR = {
  email: "audience-editor@example.com",
  password: "adminpass",
  publicId: "AudcEDTRAAA1",
} as const;

/** The reader who follows {@link ANNOUNCEMENT_AUDIENCE_SERIES}. Password hash is `memberpass`. */
export const ANNOUNCEMENT_AUDIENCE_FOLLOWER = {
  email: "audience-follower@example.com",
  name: "Audience E2E Follower",
  password: "memberpass",
  publicId: "AudcFLWRAAA1",
} as const;

/**
 * The reader who does not follow it, and holds {@link ANNOUNCEMENT_AUDIENCE_PLAN}.
 * Password hash is `memberpass`.
 */
export const ANNOUNCEMENT_AUDIENCE_READER = {
  email: "audience-reader@example.com",
  name: "Audience E2E Reader",
  password: "memberpass",
  publicId: "AudcRDERAAA1",
} as const;

/** The one series of the tenant, followed by the follower alone. */
export const ANNOUNCEMENT_AUDIENCE_SERIES = {
  publicId: "AudcSERSAAA1",
  title: "Audience Series",
} as const;

/** The plan the reader holds, the first of the tenant's two. */
export const ANNOUNCEMENT_AUDIENCE_PLAN = {
  name: "Audience Premium",
  publicId: "AudcPLANAAA1",
} as const;
