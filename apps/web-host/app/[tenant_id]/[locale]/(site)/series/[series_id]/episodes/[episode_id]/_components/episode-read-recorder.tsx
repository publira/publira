"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { useEffect, useRef } from "react";

import { markEpisodeAsReadAction } from "../_lib/actions";
import { isLastPageVisible } from "../_lib/viewer-progress";

/** What has become of this mount's attempt to record the read. */
type RecordState = "idle" | "recorded" | "sending";

/**
 * Records the read once the episode's last page is on screen. Renders nothing,
 * and belongs inside the viewer root, whose page state it reads.
 *
 * Writing the record is a synchronization with an external system — the read
 * state behind the public API — rather than something the reader did, so it
 * belongs in an Effect rather than in a page-turn handler. That is also what
 * keeps the answer the same however the page was turned: the buttons, the
 * arrow keys, and a swipe all move the viewer's index, and a spread that
 * carries the last page is finished the moment it appears, as is an episode
 * that is one page long.
 *
 * Suppression is per mount and per success. A repeated notification of the
 * same last page sends nothing, while an attempt that failed leaves the state
 * open, so the next arrival at the last page tries again. The API is the one
 * that guarantees a re-read never writes a second row or moves the first
 * timestamp; this only spares the network what it already knows the answer to.
 *
 * An arrival that lands while an attempt is still in flight is remembered and
 * taken up as soon as that attempt fails, rather than dropped. Without it, a
 * reader who turned back and returned before a failing request settled would
 * be left on the last page with the read unrecorded and no page turn left to
 * re-run the Effect.
 */
export const EpisodeReadRecorder = ({
  episodePublicId,
  tenantId,
}: {
  episodePublicId: string;
  tenantId: string;
}) => {
  const { currentIndex, pages, spreadStartIndex, viewMode } =
    useViewerContext();
  const isFinished = isLastPageVisible({
    currentIndex,
    pageCount: pages.length,
    spreadStartIndex,
    viewMode,
  });
  const recordStateRef = useRef<RecordState>("idle");
  const hasMissedArrivalRef = useRef(false);

  useEffect(() => {
    if (!isFinished || recordStateRef.current === "recorded") {
      return;
    }
    if (recordStateRef.current === "sending") {
      hasMissedArrivalRef.current = true;
      return;
    }
    recordStateRef.current = "sending";

    const record = async (): Promise<void> => {
      hasMissedArrivalRef.current = false;
      let recorded = false;
      try {
        recorded = await markEpisodeAsReadAction({
          episodePublicId,
          tenantId,
        });
      } catch {
        // The record is the only thing that failed. Pages keep turning, keep
        // loading, and keep going full screen either way.
      }
      if (!recorded && hasMissedArrivalRef.current) {
        await record();
        return;
      }
      recordStateRef.current = recorded ? "recorded" : "idle";
    };

    void record();
  }, [episodePublicId, isFinished, tenantId]);

  return null;
};
