"use client";

import {
  Viewport,
  ViewportPageSet,
  ViewportPageSlot,
  ViewportTrack,
} from "@publira/comic-viewer";
import type { ViewportGestures } from "@publira/comic-viewer";
import { useCallback, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

/** The server lays nothing out, so no box has a size there. */
const isZeroOnServer = () => 0;

/**
 * The narrowest box that shows two pages side by side, which is the library's
 * own default. A box taller than it is wide shows one page at any width: two
 * pages there would each be drawn at half its width, with the height below
 * them left empty. A square box keeps the spread.
 *
 * The box, not the window, is what is measured, so a window held either way
 * gets the spread exactly when the reader is given the room for one.
 */
const DOUBLE_PAGE_THRESHOLD = 768;

/**
 * The height of the viewer's box, read again whenever the box resizes — the
 * window turning, or the reader widening the viewer. It is `0` until the box
 * is on the page, which leaves the library's own threshold in charge.
 */
export const useBoxHeight = (box: HTMLElement | null): number => {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (box === null) {
        return () => {
          // Nothing was observed, so there is nothing to stop.
        };
      }

      const observer = new ResizeObserver(onStoreChange);
      observer.observe(box);

      return () => {
        observer.disconnect();
      };
    },
    [box]
  );

  const getHeight = useCallback(
    () => box?.getBoundingClientRect().height ?? 0,
    [box]
  );

  return useSyncExternalStore(subscribe, getHeight, isZeroOnServer);
};

/**
 * The rail the reader turns pages on: three viewports wide, holding the
 * spread before this one, the one on screen, and the one after it.
 *
 * The library compares the box's width alone with `doublePageThreshold`, so
 * the box's own height, from {@link useBoxHeight}, is handed over as the
 * threshold whenever it is the larger of the two: the spread then needs a box
 * at least {@link DOUBLE_PAGE_THRESHOLD} wide and at least as wide as it is
 * tall.
 *
 * `children` is the template every visible page is drawn from, and
 * `aria-label` names the region the pages are read in, in the reader's
 * language. `gestures` reaches the library as it is; without it, the arrow
 * keys turn pages only while the rail holds focus.
 */
export const ViewerRail = ({
  "aria-label": ariaLabel,
  boxHeight,
  children,
  gestures,
}: {
  "aria-label": string;
  boxHeight: number;
  children: ReactNode;
  gestures?: ViewportGestures;
}) => (
  <Viewport
    aria-label={ariaLabel}
    className="group relative flex size-full min-h-0 min-w-0 flex-1 touch-pan-y items-stretch overflow-hidden data-[pannable]:cursor-grab data-[pannable]:touch-none data-[panning]:cursor-grabbing"
    doublePageThreshold={Math.max(DOUBLE_PAGE_THRESHOLD, boxHeight)}
    gestures={gestures}
  >
    <ViewportTrack className="flex h-full w-[300%] shrink-0 basis-[300%] [transform:translateX(calc(-33.3333%_+_var(--pcv-drag-offset,0px)))] items-stretch data-[dragging]:transition-none data-[transition-state=active]:transition-transform data-[transition-state=active]:duration-[260ms] data-[transition-state=active]:ease-out data-[transition-state=active]:data-[slide-direction=left]:[transform:translateX(calc(-66.6667%_+_var(--pcv-drag-offset,0px)))] data-[transition-state=active]:data-[slide-direction=right]:[transform:translateX(var(--pcv-drag-offset,0px))]">
      <ViewportPageSet className="flex h-full min-w-0 shrink-0 basis-1/3 items-stretch data-[page-side=left]:justify-start data-[page-side=right]:justify-end data-[rail-slot=current]:[transform:translate(var(--pcv-pan-x,0),var(--pcv-pan-y,0))_scale(var(--pcv-zoom-scale,1))]">
        {/* The two pages of a spread meet at the centre line as they do on a
            printed sheet, so each hugs the edge of its half that faces the
            gutter. */}
        <ViewportPageSlot className="flex min-w-0 flex-1 items-center justify-center data-[page-side=left]:justify-end data-[page-side=right]:justify-start data-[view-mode=double]:max-w-1/2 data-[view-mode=double]:basis-1/2 data-[view-mode=double]:data-[page-layout=spread]:max-w-full data-[view-mode=double]:data-[page-layout=spread]:basis-full">
          {children}
        </ViewportPageSlot>
      </ViewportPageSet>
    </ViewportTrack>
  </Viewport>
);
