/**
 * Records created by `db/seeds/scenarios/140_episode_comments.sql`.
 *
 * `tenant_config.comment_mode` is one setting for a whole tenant, so the suite
 * that turns commenting on runs on a tenant of its own: on the development seed
 * tenant the section would appear under every episode the reading and
 * viewer-performance suites open.
 */

export const EPISODE_COMMENTS_SCENARIO = "140_episode_comments";

export const EPISODE_COMMENTS_TENANT = {
  /**
   * The tenant's uuid, not its `public_id`: web-host's cache tags are built
   * from the routing id, and the spec drops one of those after removing a
   * comment behind the app's back.
   */
  id: "018f0f60-0001-7000-8000-000000000001",
  name: "Comment Tenant",
  publicId: "CmntTNNTAAA1",
} as const;

export const EPISODE_COMMENTS_EPISODE = {
  /** The row's uuid, for the SQL the suite runs as staff would. */
  id: "018f0f64-0001-7000-8000-000000000001",
  publicId: "CmntEPSDAAA1",
  seriesPublicId: "CmntSERSAAA1",
  title: "Comment Episode 001-01",
} as const;

/** The reader whose comments the suite posts. Password hash is `memberpass`. */
export const EPISODE_COMMENTS_AUTHOR = {
  email: "comment-author@example.com",
  name: "Comment E2E Author",
  password: "memberpass",
  publicId: "CmntMMBRAAA1",
} as const;

/** A second reader, so "gone for everyone else" can be asserted from a browser. */
export const EPISODE_COMMENTS_READER = {
  email: "comment-reader@example.com",
  name: "Comment E2E Reader",
  password: "memberpass",
  publicId: "CmntMMBRAAA2",
} as const;

/** Path of the episode the whole suite comments on. */
export const EPISODE_COMMENTS_PATH = `/series/${EPISODE_COMMENTS_EPISODE.seriesPublicId}/episodes/${EPISODE_COMMENTS_EPISODE.publicId}`;
