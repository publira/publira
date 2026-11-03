import { EpisodeReviewState } from "@publira/api-client/admin/types";

import { EPISODE_REVIEW_STATES } from "./episode-review-state";
import type { EpisodeReviewStateValue } from "./episode-review-state";

/**
 * The proto enum each value stands for, read in both directions so the two
 * halves of the conversion cannot drift apart.
 */
const EPISODE_REVIEW_STATE_ENUM: Record<
  EpisodeReviewStateValue,
  EpisodeReviewState
> = {
  approved: EpisodeReviewState.APPROVED,
  in_review: EpisodeReviewState.IN_REVIEW,
  returned: EpisodeReviewState.RETURNED,
};

/**
 * The empty value for an episode no round was opened for — unspecified, or a
 * response that carried no review — and for a state this build does not know,
 * which the console then shows as it shows an episode never reviewed.
 */
export const toEpisodeReviewStateValue = (
  state: EpisodeReviewState | undefined
): "" | EpisodeReviewStateValue =>
  EPISODE_REVIEW_STATES.find(
    (value) => EPISODE_REVIEW_STATE_ENUM[value] === state
  ) ?? "";
