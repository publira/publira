/**
 * Records created by `db/seeds/scenarios/150_comment_moderation.sql`.
 *
 * `tenant_config.comment_mode` is one setting for a whole tenant, so the
 * tenant whose comments wait for approval is not the one
 * `140_episode_comments.sql` puts on `immediate`. This one owns both sides of
 * the round trip the moderation suite drives: an administrator for its console
 * and a member to post as.
 */

export const COMMENT_MODERATION_SCENARIO = "150_comment_moderation";

export const COMMENT_MODERATION_TENANT = {
  /**
   * The tenant's uuid, not its `public_id`: web-host's cache tags are built
   * from the routing id, and the suite drops one after approving a comment.
   */
  id: "018f0f70-0001-7000-8000-000000000001",
  name: "Moderation Tenant",
  publicId: "ModrTNNTAAA1",
} as const;

export const COMMENT_MODERATION_EPISODE = {
  publicId: "ModrEPSDAAA1",
  seriesPublicId: "ModrSERSAAA1",
  title: "Moderation Episode 001-01",
} as const;

/** The administrator who works the queue. Password hash is `adminpass`. */
export const COMMENT_MODERATION_ADMIN = {
  email: "moderate-admin@example.com",
  name: "Moderation E2E Admin",
  password: "adminpass",
  publicId: "ModrADMNAAA1",
} as const;

/** The reader whose comments the suite posts. Password hash is `memberpass`. */
export const COMMENT_MODERATION_MEMBER = {
  email: "moderate-member@example.com",
  name: "Moderation E2E Member",
  password: "memberpass",
  publicId: "ModrMMBRAAA1",
} as const;

/** Path of the episode the suite comments on. */
export const COMMENT_MODERATION_PATH = `/series/${COMMENT_MODERATION_EPISODE.seriesPublicId}/episodes/${COMMENT_MODERATION_EPISODE.publicId}`;
