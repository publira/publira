"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { useEffect, useRef } from "react";

import type { EpisodeDetail, EpisodeSeriesSummary } from "#lib/catalog";

import type { ReadingPositionSaver } from "../_lib/reading-position";
import {
  createReadingPositionSaver,
  readingPositionBeaconPath,
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
 * `sendBeacon` hands the request to the browser, which delivers it on its own
 * schedule and keeps it alive across the navigation a reader leaving the
 * episode makes. There is nothing to await and no answer to read, so the API
 * owns what that costs: it decides whether this reader may record a position
 * at all, and a page outside the episode is refused there.
 */
export const EpisodeReadingPositionRecorder = ({
  episode,
  series,
}: {
  episode: EpisodeDetail;
  series: EpisodeSeriesSummary;
}) => {
  const { currentIndex } = useViewerContext();
  const beaconPath = readingPositionBeaconPath(
    series.publicId,
    episode.publicId
  );
  const saverRef = useRef<ReadingPositionSaver | null>(null);

  useEffect(() => {
    const saver = createReadingPositionSaver({
      send: (pageIndex) => sendReadingPositionBeacon(beaconPath, pageIndex),
    });
    saverRef.current = saver;

    // `pagehide` rather than `unload`: a page the browser keeps for the back
    // button is never unloaded, and a mobile browser may kill the tab without
    // ever firing it.
    const flush = () => {
      saver.flush();
    };
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("pagehide", flush);
      saverRef.current = null;
      // The reader navigated away inside the app, which the browser reports
      // through no event of its own.
      saver.flush();
    };
  }, [beaconPath]);

  useEffect(() => {
    saverRef.current?.save(currentIndex);
  }, [currentIndex]);

  return null;
};
