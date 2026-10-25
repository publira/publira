import type { EpisodePageReachItem } from "#lib/engagement";

/** One page of the report, with the readers who left the episode at it. */
export interface DropOffRow extends EpisodePageReachItem {
  leftCount: number;
}

/**
 * The readers who stopped at each page: those who reached it less those who
 * reached the next, and at the last page everyone who reached it.
 */
export const toDropOffRows = (
  pages: readonly EpisodePageReachItem[]
): DropOffRow[] =>
  pages.map((page, index) => ({
    ...page,
    leftCount: page.readerCount - (pages[index + 1]?.readerCount ?? 0),
  }));
