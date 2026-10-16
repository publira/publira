"use client";

// `@publira/comic-viewer` carries no directive of its own and creates its
// contexts as it is evaluated, so every module here that renders it carries
// one: the package root is imported from Server Components for
// `toViewerPages`, and must not pull the library into the server graph.

import {
  PageProgress,
  PageProgressSlider,
  PageStatus,
  Toolbar,
} from "@publira/comic-viewer";
import type { PageStatusValue } from "@publira/comic-viewer";
import type { ReactNode } from "react";

/**
 * A band of the same colour as the mat, told apart from it by a hairline,
 * holding {@link ViewerProgress} and, where the app has any, its own controls
 * in {@link ViewerToolbarActions}.
 *
 * On a narrow screen a centred slider would run under those controls, so the
 * toolbar keeps their width clear and the slider takes the rest — the wider
 * width where a coarse pointer grows the buttons to 44px. The room kept is two
 * icon buttons'.
 */
export const ViewerToolbar = ({ children }: { children: ReactNode }) => (
  <Toolbar className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-viewer-rule bg-viewer-mat p-3 transition duration-state ease-state aria-hidden:translate-y-2 aria-hidden:opacity-0 max-sm:has-data-viewer-toolbar-actions:pr-26 max-sm:pointer-coarse:has-data-viewer-toolbar-actions:pr-30">
    {children}
  </Toolbar>
);

/** The reading progress: {@link ViewerProgressSlider} over {@link ViewerPageStatus}. */
export const ViewerProgress = ({
  "aria-label": ariaLabel,
  children,
}: {
  "aria-label": string;
  children: ReactNode;
}) => (
  <PageProgress
    aria-label={ariaLabel}
    className="mx-auto min-w-0 shrink basis-3/5 max-sm:basis-full"
  >
    {children}
  </PageProgress>
);

/**
 * The slider the reader scrubs through the episode with. `format` names the
 * pages under the thumb in `aria-valuetext`, and is the one
 * {@link ViewerPageStatus} is given, so the status a reader sees and the value
 * a screen reader announces are the same words.
 */
export const ViewerProgressSlider = ({
  format,
}: {
  format: (value: PageStatusValue) => string;
}) => (
  // The toolbar runs rtl so the thumb moves, and the fill grows, the way pages
  // turn; the status text still reads left to right. The input is taller than
  // its thumb so a finger can catch it, and both grow where the pointer is a
  // finger.
  <PageProgressSlider
    className="block h-6 w-full cursor-pointer appearance-none rounded-control bg-transparent p-0 [--pcv-page-progress-fill-direction:to_right] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-viewer-mat focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 rtl:[--pcv-page-progress-fill-direction:to_left] pointer-coarse:h-11 [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-viewer-ink pointer-coarse:[&::-moz-range-thumb]:size-5 [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-control [&::-moz-range-track]:bg-viewer-rule [&::-moz-range-track]:[background-image:linear-gradient(var(--pcv-page-progress-fill-direction),var(--viewer-ink)_var(--pcv-page-progress-fill),transparent_var(--pcv-page-progress-fill))] [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-control [&::-webkit-slider-runnable-track]:bg-viewer-rule [&::-webkit-slider-runnable-track]:[background-image:linear-gradient(var(--pcv-page-progress-fill-direction),var(--viewer-ink)_var(--pcv-page-progress-fill),transparent_var(--pcv-page-progress-fill))] [&::-webkit-slider-thumb]:-mt-[0.3125rem] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-viewer-ink pointer-coarse:[&::-webkit-slider-thumb]:-mt-2 pointer-coarse:[&::-webkit-slider-thumb]:size-5"
    format={format}
  />
);

/** Names the pages on screen, in the words `format` gives them. */
export const ViewerPageStatus = ({
  format,
}: {
  format: (value: PageStatusValue) => string;
}) => (
  <PageStatus
    className="block text-center text-sm text-viewer-ink tabular-nums [direction:ltr]"
    format={format}
  />
);

/**
 * The app's own controls, placed against the physical right edge rather than
 * laid out in the toolbar's flow, which runs right to left with the reading
 * direction.
 */
export const ViewerToolbarActions = ({ children }: { children: ReactNode }) => (
  <div
    className="absolute right-3 bottom-3 flex gap-2"
    data-viewer-toolbar-actions
  >
    {children}
  </div>
);
