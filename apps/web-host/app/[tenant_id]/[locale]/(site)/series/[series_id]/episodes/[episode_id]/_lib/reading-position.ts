import type { WaitForConnection } from "./delivery";
import { postReport, waitForConnection } from "./delivery";

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

/** Send one position and resolve whether the server answered. */
export const sendReadingPosition = (
  path: string,
  pageIndex: number
): Promise<boolean> => postReport(path, { pageIndex });

/**
 * Hand one position to the browser for a page that is going away, where no
 * answer can be awaited. Whether it arrives stays unknown, so the saver never
 * counts it as saved.
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
  /** The page is going away: hand what is unsaved to the browser. */
  leave: () => void;
}

/**
 * Collects page turns and sends the page the reader rests on.
 *
 * A page counts as saved only once the server answered for it. A page equal
 * to the last one saved or in flight is not sent again, and turning back to
 * it inside the delay drops what was waiting, so a reader paging over the
 * same spread produces one request rather than one per turn. One request is
 * in flight at a time, so an older page never lands after a newer one.
 *
 * A send that fails keeps its page unsaved and sends it again when the
 * connection returns, unless the reader has since moved on to a page that
 * supersedes it.
 */
export const createReadingPositionSaver = ({
  beacon,
  delayMs = READING_POSITION_SAVE_DELAY_MS,
  onReconnect = waitForConnection,
  send,
}: {
  beacon: (pageIndex: number) => boolean;
  delayMs?: number;
  onReconnect?: WaitForConnection;
  send: (pageIndex: number) => Promise<boolean>;
}): ReadingPositionSaver => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopWaiting: (() => void) | null = null;
  let pendingPageIndex: number | null = null;
  let inFlightPageIndex: number | null = null;
  let savedPageIndex: number | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const deliver = async () => {
    cancelTimer();
    stopWaiting?.();
    stopWaiting = null;
    const pageIndex = pendingPageIndex;
    if (pageIndex === null || inFlightPageIndex !== null) {
      return;
    }
    pendingPageIndex = null;
    inFlightPageIndex = pageIndex;
    const delivered = await send(pageIndex);
    inFlightPageIndex = null;
    if (!delivered) {
      pendingPageIndex ??= pageIndex;
      stopWaiting = onReconnect(() => {
        void deliver();
      });
      return;
    }
    savedPageIndex = pageIndex;
    // A page the reader rested on while this one was in flight.
    if (pendingPageIndex !== null && timer === null) {
      await deliver();
    }
  };

  const flush = () => {
    void deliver();
  };

  return {
    flush,
    leave: () => {
      cancelTimer();
      if (pendingPageIndex !== null) {
        beacon(pendingPageIndex);
      }
    },
    save: (pageIndex: number) => {
      cancelTimer();
      if (pageIndex === (inFlightPageIndex ?? savedPageIndex)) {
        pendingPageIndex = null;
        return;
      }
      pendingPageIndex = pageIndex;
      timer = setTimeout(flush, delayMs);
    },
  };
};
