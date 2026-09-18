"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { useEffect, useRef } from "react";

import type { EpisodeDetail, EpisodeSeriesSummary } from "#lib/catalog";

import type { Report } from "../_lib/delivery";
import { createReport, postReport } from "../_lib/delivery";
import { isLastPageVisible } from "../_lib/viewer-progress";

/**
 * The tenant-scoped endpoint the report reaches. `proxy.ts` rewrites `/api/…`
 * onto the resolved tenant, so the reader's URL carries no tenant and no
 * locale segment.
 */
const episodeReadBeaconPath = (
  seriesPublicId: string,
  episodePublicId: string
): string =>
  `/api/v1/series/${encodeURIComponent(seriesPublicId)}/episodes/${encodeURIComponent(episodePublicId)}/read`;

/**
 * Reports the episode as read once its last page is on screen. Renders
 * nothing, and belongs inside the viewer root, whose page state it reads.
 *
 * The report is a synchronization with an external system — the read state
 * behind the public API — rather than anything the reader did, so it belongs
 * in an Effect rather than in a page-turn handler. That is also what keeps the
 * answer the same however the page was turned: the buttons, the arrow keys,
 * and a swipe all move the viewer's index, and a spread that carries the last
 * page is finished the moment it appears, as is an episode that is one page
 * long.
 *
 * The report is sent with `fetch` and counts as made only once the API
 * answered, so a finish reached while the connection is gone is sent again
 * when it returns, and the next arrival at the last page also tries again.
 * `keepalive` carries it across the navigation a finished episode invites.
 * The API decides whether this reader may record the episode at all, and a
 * re-read never writes a second row or moves the first timestamp. The
 * suppression here keeps the reader who pages back and forth over the last
 * spread to one request rather than one per turn.
 */
export const EpisodeReadRecorder = ({
  episode,
  series,
}: {
  episode: EpisodeDetail;
  series: EpisodeSeriesSummary;
}) => {
  const { currentIndex, pages, spreadStartIndex, viewMode } =
    useViewerContext();
  const isFinished = isLastPageVisible({
    currentIndex,
    pageCount: pages.length,
    spreadStartIndex,
    viewMode,
  });
  const reportRef = useRef<Report | null>(null);

  useEffect(() => {
    // The episode is named by the path, so the body is an empty object.
    reportRef.current = createReport({
      deliver: () =>
        postReport(episodeReadBeaconPath(series.publicId, episode.publicId)),
    });
    return () => {
      reportRef.current = null;
    };
  }, [episode.publicId, series.publicId]);

  useEffect(() => {
    if (isFinished) {
      reportRef.current?.send();
    }
  }, [isFinished]);

  return null;
};
