import type { PageStatusValue } from "@publira/comic-viewer";

/**
 * What the reader has on screen, in the terms a page status names it: no page
 * of the document, the end page, one page, or the two pages of a spread.
 */
export type VisiblePages =
  | { kind: "none" }
  | { kind: "end-page" }
  | { first: number; kind: "page"; total: number }
  | { first: number; kind: "spread"; last: number; total: number };

/**
 * Reads the value `PageStatus` and `PageProgressSlider` format into what is
 * on screen, so each app words the same four cases from its own catalog.
 *
 * An extra page is counted in neither the numbers nor the total, so a screen
 * holding nothing else has no page number to report.
 */
export const describeVisiblePages = ({
  firstPage,
  lastPage,
  pageCount,
  slot,
}: PageStatusValue): VisiblePages => {
  if (pageCount === 0) {
    return { kind: "none" };
  }

  if (firstPage === 0) {
    return slot === "end" ? { kind: "end-page" } : { kind: "none" };
  }

  return firstPage === lastPage
    ? { first: firstPage, kind: "page", total: pageCount }
    : { first: firstPage, kind: "spread", last: lastPage, total: pageCount };
};
