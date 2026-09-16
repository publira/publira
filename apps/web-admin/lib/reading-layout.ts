/**
 * How the pages of a work are laid out: which way they are turned, and from
 * which page two share a screen.
 *
 * Strings and plain numbers rather than the generated `ReadingDirection` enum,
 * because that is what a form posts. `series.ts` and `episode.ts` are where
 * they meet the enum, and they are in the server graph — this module is the
 * half a Client Component may import.
 */
export const READING_DIRECTIONS = ["rtl", "ltr"] as const;

export type ReadingDirectionValue = (typeof READING_DIRECTIONS)[number];

/** What a series nobody has set is read in, as the API stores it. */
export const DEFAULT_READING_DIRECTION: ReadingDirectionValue = "rtl";

/** The zero-based index a series nobody has set pairs from: the cover alone. */
export const DEFAULT_SPREAD_START_INDEX = 1;

export const isReadingDirectionValue = (
  value: string
): value is ReadingDirectionValue =>
  READING_DIRECTIONS.some((direction) => direction === value);

/** The layout a series states, which every episode that sets nothing follows. */
export interface ReadingLayout {
  readingDirection: ReadingDirectionValue;
  spreadStartIndex: number;
}

/**
 * What one episode states of its own. The empty direction and an absent index
 * are the episode following its series, stored as no value at all — which is
 * what keeps it following after the series changes.
 */
export interface EpisodeReadingLayoutOverrides {
  readingDirection: "" | ReadingDirectionValue;
  spreadStartIndex?: number;
}

/**
 * The forms speak in page numbers, since that is what an operator counts in,
 * and the API in zero-based indexes.
 */
export const spreadStartPageOf = (spreadStartIndex: number): number =>
  spreadStartIndex + 1;
