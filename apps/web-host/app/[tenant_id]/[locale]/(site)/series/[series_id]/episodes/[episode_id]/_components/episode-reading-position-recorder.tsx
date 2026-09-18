"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { useEffect, useRef } from "react";

import type { EpisodeDetail, EpisodeSeriesSummary } from "#lib/catalog";

import type { ReadingPositionSaver } from "../_lib/reading-position";
import {
  createReadingPositionSaver,
  readingPositionBeaconPath,
  sendReadingPosition,
  sendReadingPositionBeacon,
} from "../_lib/reading-position";

/**
 * Reports where the reader is in the episode, so opening it again starts
 * there. Renders nothing, and belongs inside the viewer root, whose page state
 * it reads.
 *
 * The report is a synchronization with an external system — the reading
 * position behind the public API — rather than anything the reader did, so it
 * belongs in an Effect rather than in a page-turn handler. That is also what
 * keeps the answer the same however the page was turned: the buttons, the
 * arrow keys, and a swipe all move the viewer's index.
 *
 * It is mounted for a signed-in reader only. A guest has no position to save,
 * and the API would discard the write, so the beacon is not sent at all.
 *
 * A position counts as saved only once the API answered for it, so a page
 * turned while the connection is gone is sent again when it returns. Only
 * `pagehide` falls back to `sendBeacon`, since a page going away can await
 * nothing. The API decides whether this reader may record a position at all,
 * and refuses a page outside the episode.
 */
export const EpisodeReadingPositionRecorder = ({
  episode,
  series,
}: {
  episode: EpisodeDetail;
  series: EpisodeSeriesSummary;
}) => {
  const { currentIndex, pages } = useViewerContext();
  // The viewer also holds pages of its own after the last one of the episode,
  // and the API refuses a position that names none of the episode's pages.
  const pageIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
  const beaconPath = readingPositionBeaconPath(
    series.publicId,
    episode.publicId
  );
  const saverRef = useRef<ReadingPositionSaver | null>(null);

  useEffect(() => {
    const saver = createReadingPositionSaver({
      beacon: (index) => sendReadingPositionBeacon(beaconPath, index),
      send: (index) => sendReadingPosition(beaconPath, index),
    });
    saverRef.current = saver;

    // `pagehide` rather than `unload`: a page the browser keeps for the back
    // button is never unloaded, and a mobile browser may kill the tab without
    // ever firing it.
    const leave = () => {
      saver.leave();
    };
    window.addEventListener("pagehide", leave);

    return () => {
      window.removeEventListener("pagehide", leave);
      saverRef.current = null;
      // The reader navigated away inside the app, which the browser reports
      // through no event of its own. The document stays, so the send can
      // still be confirmed and retried.
      saver.flush();
    };
  }, [beaconPath]);

  useEffect(() => {
    saverRef.current?.save(pageIndex);
  }, [pageIndex]);

  return null;
};
