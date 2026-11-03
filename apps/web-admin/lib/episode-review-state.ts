export const EPISODE_REVIEW_STATES = [
  "approved",
  "in_review",
  "returned",
] as const;

/** Where an episode stands in review, as the console names it. */
export type EpisodeReviewStateValue = (typeof EPISODE_REVIEW_STATES)[number];

/**
 * The review state a screen marks an episode with: only a scheduled episode
 * waits on review, and only while the tenant requires it. A published episode
 * keeps the state its last round left, and a tenant that turned review off
 * publishes every scheduled episode at its time whatever its state says.
 */
export const pendingEpisodeReviewState = (
  episode: { reviewState: "" | EpisodeReviewStateValue; status: string },
  reviewRequired: boolean
): "in_review" | "returned" | undefined => {
  if (!reviewRequired || episode.status !== "scheduled") {
    return;
  }

  if (
    episode.reviewState === "in_review" ||
    episode.reviewState === "returned"
  ) {
    return episode.reviewState;
  }
};
