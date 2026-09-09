"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useLocale, useTenantDefaultLocale } from "#components/locale-provider";
import { withLocalePrefix } from "#lib/locale-path";

import type { EpisodeNeighborSide } from "../_lib/neighbor-navigation";
import {
  isControlKeyTarget,
  resolveNeighborSide,
} from "../_lib/neighbor-navigation";
import { isLastPageVisible } from "../_lib/viewer-progress";

/** The two sentences the first press shows, resolved on the server. */
export interface EpisodeNeighborKeyNavigationCopy {
  nextHint: string;
  previousHint: string;
}

/**
 * Watches for the arrow key that has run out of pages and, on a second press
 * of it, opens the episode on that side.
 *
 * One press does not move the reader: the key that turns pages is the key that
 * leaves the episode, so a reader skimming forward would otherwise be carried
 * out of the last page they meant to look at. The first press says what the
 * next one will do, and the sentence it shows is the only feedback there is —
 * the viewer itself does nothing at an end, which reads as a broken key.
 *
 * The listener runs in the capture phase because the viewport stops the key
 * presses it handles from travelling any further: a listener on the bubbling
 * phase would never see an arrow key at all while the pages hold focus. That
 * puts this ahead of the viewer's own handling, so it applies the same
 * exception the viewer does and leaves a key press aimed at a control alone.
 */
const NeighborKeyListener = ({
  copy,
  nextHref,
  previousHref,
}: {
  copy: EpisodeNeighborKeyNavigationCopy;
  nextHref?: string;
  previousHref?: string;
}) => {
  const { readingDirection } = useViewerContext();
  const router = useRouter();
  const locale = useLocale();
  const defaultLocale = useTenantDefaultLocale();
  const [armedSide, setArmedSide] = useState<EpisodeNeighborSide | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A held key repeats on its own, and the reader who reaches the end
      // holding it is exactly the one this guard is for: counting a repeat as
      // the second press would arm on one event and leave the episode on the
      // next. Only a key released and pressed again moves them.
      if (event.repeat || isControlKeyTarget(event.target)) {
        return;
      }
      const side = resolveNeighborSide(event.key, readingDirection);
      if (side === undefined) {
        return;
      }
      const href = side === "next" ? nextHref : previousHref;
      if (href === undefined) {
        return;
      }
      if (armedSide !== side) {
        setArmedSide(side);
        return;
      }
      router.push(withLocalePrefix(locale, defaultLocale, href));
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    armedSide,
    defaultLocale,
    locale,
    nextHref,
    previousHref,
    readingDirection,
    router,
  ]);

  if (armedSide === null) {
    return null;
  }

  return (
    // Above the toolbar and clear of the page-turn buttons, and taking no
    // pointer events, so the sentence never stands between the reader and the
    // page underneath it.
    <output className="pointer-events-none absolute inset-x-0 bottom-24 z-10 block text-center">
      <span className="rounded-full bg-black/70 px-3 py-1.5 text-sm text-neutral-100">
        {armedSide === "next" ? copy.nextHint : copy.previousHint}
      </span>
    </output>
  );
};

/**
 * Keyboard access to the neighbouring episodes, for the reader who turns pages
 * with the arrow keys and never touches the chrome.
 *
 * An episode is only offered at the end of the pages it belongs on, so the
 * listener is handed an href only where the reader has run out of pages in
 * that direction. Its `key` is the page the reader is on, so turning a page
 * unmounts it and takes an armed key press with it: a press left over from the
 * last page must not open the next episode once the reader has gone back into
 * this one.
 *
 * Renders nothing until a key is armed, and belongs inside the viewer root,
 * whose page state it reads.
 */
export const EpisodeNeighborKeyNavigation = ({
  copy,
  nextHref,
  previousHref,
}: {
  copy: EpisodeNeighborKeyNavigationCopy;
  /** Absent at the end of the series, where there is nothing to open. */
  nextHref?: string;
  /** Absent on the first episode, for the same reason. */
  previousHref?: string;
}) => {
  const { currentIndex, minIndex, pageCount, spreadStartIndex, viewMode } =
    useViewerContext();
  const atLastPage = isLastPageVisible({
    currentIndex,
    pageCount,
    spreadStartIndex,
    viewMode,
  });

  return (
    <NeighborKeyListener
      copy={copy}
      key={currentIndex}
      nextHref={atLastPage ? nextHref : undefined}
      previousHref={currentIndex <= minIndex ? previousHref : undefined}
    />
  );
};
