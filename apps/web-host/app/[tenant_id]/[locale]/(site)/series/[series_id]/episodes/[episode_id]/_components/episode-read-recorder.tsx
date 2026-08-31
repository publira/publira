"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { useEffect, useRef } from "react";

import type { EpisodeDetail } from "#lib/catalog";

import { isLastPageVisible } from "../_lib/viewer-progress";

/**
 * The tenant-scoped endpoint the beacon reaches. `proxy.ts` rewrites `/api/…`
 * onto the resolved tenant, so the reader's URL carries no tenant and no
 * locale segment.
 */
const EPISODE_READ_BEACON_PATH = "/api/v1/episode-reads";

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
 * `sendBeacon` hands the request to the browser, which delivers it on its own
 * schedule and keeps it alive across the navigation a finished episode
 * invites. There is nothing to await and no answer to read, so the API owns
 * both halves of what that costs: it decides whether this reader may record
 * the episode at all, and a re-read never writes a second row or moves the
 * first timestamp. The suppression here counts only what this mount has
 * already handed over, so the reader who pages back and forth over the last
 * spread sends one beacon rather than one per turn.
 *
 * A beacon the browser refused to queue is the one case worth another go, so
 * that leaves the state open and the next arrival at the last page tries
 * again.
 */
export const EpisodeReadRecorder = ({
  episode,
}: {
  episode: EpisodeDetail;
}) => {
  const { currentIndex, pages, spreadStartIndex, viewMode } =
    useViewerContext();
  const isFinished = isLastPageVisible({
    currentIndex,
    pageCount: pages.length,
    spreadStartIndex,
    viewMode,
  });
  const hasReportedRef = useRef(false);
  const { publicId } = episode;

  useEffect(() => {
    if (!isFinished || hasReportedRef.current) {
      return;
    }

    // A JSON body is not a CORS-safelisted content type, so a cross-origin
    // page cannot send this beacon at all — the same-origin check on the
    // endpoint is the guard, and this is the layer above it.
    hasReportedRef.current = navigator.sendBeacon(
      EPISODE_READ_BEACON_PATH,
      new Blob([JSON.stringify({ publicId })], { type: "application/json" })
    );
  }, [isFinished, publicId]);

  return null;
};
