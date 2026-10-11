import type { ViewMode } from "@publira/comic-viewer";

/**
 * Whether the pages the viewer currently shows include the last one.
 *
 * This is the rule `PageStatus` announces, read back from the viewer's own
 * page state: a spread only forms from `spreadStartIndex` onwards, and only
 * while another page follows the current one, so the visible run is two pages
 * wide there and one page wide everywhere else.
 *
 * Asking what is on screen — rather than whether the next-page control has run
 * out of pages — is what lets every way of turning a page share one answer,
 * button, keyboard, and swipe alike, and what makes a single-page episode
 * finished from its first paint.
 */
export const isLastPageVisible = ({
  currentIndex,
  pageCount,
  spreadStartIndex,
  viewMode,
}: {
  currentIndex: number;
  pageCount: number;
  spreadStartIndex: number;
  viewMode: ViewMode;
}): boolean => {
  if (pageCount === 0) {
    return false;
  }

  const visiblePageCount =
    viewMode === "double" &&
    currentIndex >= spreadStartIndex &&
    currentIndex + 1 < pageCount
      ? 2
      : 1;

  return currentIndex + visiblePageCount >= pageCount;
};
