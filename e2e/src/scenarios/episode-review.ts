/**
 * Records created by `db/seeds/scenarios/750_episode_review.sql`. Re-applying
 * it deletes the tenant and writes it again with review off, which takes the
 * rounds of review with it.
 */

export const EPISODE_REVIEW_SCENARIO = "750_episode_review";

/** The tenant admin, who turns review on and decides each round. Password hash is `adminpass`. */
export const EPISODE_REVIEW_ADMIN = {
  email: "review-admin@example.com",
  name: "Review Admin",
  password: "adminpass",
} as const;

/** The editor, who schedules the episode and submits it. Password hash is `adminpass`. */
export const EPISODE_REVIEW_EDITOR = {
  email: "review-editor@example.com",
  name: "Review Editor",
  password: "adminpass",
} as const;

/** The auditor, who reads the review and is offered no control. Password hash is `adminpass`. */
export const EPISODE_REVIEW_AUDITOR = {
  email: "review-auditor@example.com",
  name: "Review Auditor",
  password: "adminpass",
} as const;

/** The published series and its one draft episode. */
export const EPISODE_REVIEW_CATALOG = {
  episodePublicId: "RvewEPSDAAA1",
  episodeTitle: "Review Episode 001-01",
  seriesPublicId: "RvewSERSAAA1",
} as const;
