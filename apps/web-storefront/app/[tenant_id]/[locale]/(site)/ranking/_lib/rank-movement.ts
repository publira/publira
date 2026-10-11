/**
 * How a position moved since the period before it.
 *
 * `new` is not a movement of zero: a series the earlier snapshot did not rank
 * has no position to be compared against, and the API says so by leaving
 * `previousRank` out rather than by sending 0.
 */
export type RankMovement =
  | { kind: "new" }
  | { kind: "same" }
  | { kind: "down"; steps: number }
  | { kind: "up"; steps: number };

/**
 * A smaller number is a better position, so a previous rank above the current
 * one is a climb. Both values come from a snapshot the batch wrote, where a
 * position counts from 1; anything at or below 0 is not a position this can
 * measure against and reads as a new entry.
 */
export const rankMovement = (
  rank: number,
  previousRank?: number
): RankMovement => {
  if (previousRank === undefined || previousRank <= 0) {
    return { kind: "new" };
  }

  if (previousRank > rank) {
    return { kind: "up", steps: previousRank - rank };
  }

  if (previousRank < rank) {
    return { kind: "down", steps: rank - previousRank };
  }

  return { kind: "same" };
};
