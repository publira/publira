/**
 * How long the reader stays on a page before it is worth saving.
 *
 * A page turn is not a decision to stop there: a reader skimming forward
 * crosses ten pages in a couple of seconds, and each one would otherwise be a
 * request. The delay is short enough that the page a reader actually settles
 * on is saved long before they leave, and `pagehide` covers the reader who
 * leaves inside the window.
 */
export const READING_POSITION_SAVE_DELAY_MS = 1500;

/**
 * The page the viewer opens at, given the position the reader left and how
 * many pages the episode holds now.
 *
 * A saved page is measured against the episode as it was, so a body replaced
 * with a shorter one can leave a position past its end. That resumes at the
 * last page rather than at an index the viewer has nothing to draw for.
 */
export const resumePageIndex = (
  savedPageIndex: number | null,
  pageCount: number
): number => {
  if (savedPageIndex === null || savedPageIndex <= 0 || pageCount === 0) {
    return 0;
  }
  return Math.min(savedPageIndex, pageCount - 1);
};

/**
 * The tenant-scoped endpoint the beacon reaches. `proxy.ts` rewrites `/api/…`
 * onto the resolved tenant, so the reader's URL carries no tenant and no
 * locale segment.
 */
export const readingPositionBeaconPath = (
  seriesPublicId: string,
  episodePublicId: string
): string =>
  `/api/v1/series/${encodeURIComponent(seriesPublicId)}/episodes/${encodeURIComponent(episodePublicId)}/reading-position`;

/**
 * Hand one position to the browser to deliver. The JSON content type is what
 * keeps the request off the CORS safelist, so a cross-origin page cannot send
 * it at all — the same-origin check on the endpoint is the guard, and this is
 * the layer above it.
 *
 * The answer is whether the browser accepted the beacon for delivery, not
 * whether it was written: nothing reads the response.
 */
export const sendReadingPositionBeacon = (
  path: string,
  pageIndex: number
): boolean =>
  navigator.sendBeacon(
    path,
    new Blob([JSON.stringify({ pageIndex })], { type: "application/json" })
  );

export interface ReadingPositionSaver {
  /** The reader is on this page now. */
  save: (pageIndex: number) => void;
  /** Send what is waiting, without waiting for the delay to run out. */
  flush: () => void;
}

/**
 * Collects page turns and sends the page the reader rests on.
 *
 * A page equal to the last one sent is not sent again, and turning back to it
 * inside the delay drops what was waiting, so a reader paging over the same
 * spread produces one request rather than one per turn. A beacon the browser
 * refused to queue leaves the last sent page as it was, which is what makes
 * the next turn try again.
 */
export const createReadingPositionSaver = ({
  delayMs = READING_POSITION_SAVE_DELAY_MS,
  send,
}: {
  delayMs?: number;
  send: (pageIndex: number) => boolean;
}): ReadingPositionSaver => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingPageIndex: number | null = null;
  let sentPageIndex: number | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    cancelTimer();
    const pageIndex = pendingPageIndex;
    pendingPageIndex = null;
    if (pageIndex === null) {
      return;
    }
    if (send(pageIndex)) {
      sentPageIndex = pageIndex;
    }
  };

  return {
    flush,
    save: (pageIndex: number) => {
      cancelTimer();
      if (pageIndex === sentPageIndex) {
        pendingPageIndex = null;
        return;
      }
      pendingPageIndex = pageIndex;
      timer = setTimeout(flush, delayMs);
    },
  };
};
