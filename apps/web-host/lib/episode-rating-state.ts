/** The stored ceiling, and how many presses `multiple` mode will take. */
export const MAX_EPISODE_REACTION_SCORE = 5;

/** How the control takes a reaction: one press, or up to five. */
export type EpisodeReactionMode = "single" | "multiple";

export interface EpisodeReactionState {
  ratingCount: number;
  score: number;
}

/**
 * What one press does to the control the reader is looking at. The count
 * moves only on the first press, because it is readers rather than presses.
 */
export const applyReactionPress = (
  current: EpisodeReactionState,
  mode: EpisodeReactionMode
): EpisodeReactionState => {
  if (current.score >= MAX_EPISODE_REACTION_SCORE) {
    return current;
  }
  return {
    ratingCount:
      current.score === 0 ? current.ratingCount + 1 : current.ratingCount,
    score: mode === "single" ? MAX_EPISODE_REACTION_SCORE : current.score + 1,
  };
};

/**
 * How far the heart is filled: empty until the first press, then the whole
 * heart in `single` mode, and `score / 5` in `multiple` mode.
 */
export const reactionFillRatio = (
  score: number,
  mode: EpisodeReactionMode
): number => {
  if (score <= 0) {
    return 0;
  }
  if (mode === "single") {
    return 1;
  }
  return (
    Math.min(score, MAX_EPISODE_REACTION_SCORE) / MAX_EPISODE_REACTION_SCORE
  );
};
