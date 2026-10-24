"use client";

import {
  NextPageButton,
  PageNavigation,
  PreviousPageButton,
  useViewerContext,
} from "@publira/comic-viewer";
import { ChevronLeftIcon, ChevronRightIcon } from "@publira/icons";
import { buttonVariants } from "@publira/ui-components/button";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

/**
 * The page-turn pair, drawn and hidden with the controls a tap reveals.
 * `children` are {@link ViewerPreviousPageButton} and
 * {@link ViewerNextPageButton}, or whatever the app puts in their place.
 */
export const ViewerPageNavigation = ({
  "aria-label": ariaLabel,
  children,
}: {
  "aria-label": string;
  children: ReactNode;
}) => (
  <PageNavigation
    aria-label={ariaLabel}
    className="pointer-events-none absolute inset-0 z-10 transition duration-state ease-state aria-hidden:translate-y-2 aria-hidden:opacity-0"
  >
    {children}
  </PageNavigation>
);

/** The chevron that points back through the episode, whichever way it reads. */
export const ViewerBackwardIcon = () => {
  const { readingDirection } = useViewerContext();

  return readingDirection === "rtl" ? (
    <ChevronRightIcon aria-hidden="true" className="size-5" />
  ) : (
    <ChevronLeftIcon aria-hidden="true" className="size-5" />
  );
};

/** The chevron that points on through the episode, whichever way it reads. */
export const ViewerForwardIcon = () => {
  const { readingDirection } = useViewerContext();

  return readingDirection === "rtl" ? (
    <ChevronLeftIcon aria-hidden="true" className="size-5" />
  ) : (
    <ChevronRightIcon aria-hidden="true" className="size-5" />
  );
};

const pageTurnButtonClassName = cn(
  buttonVariants({ size: "icon", variant: "outline" }),
  "pointer-events-auto absolute top-1/2"
);

/** Turns back a page, from the edge the episode starts at. */
export const ViewerPreviousPageButton = ({
  "aria-label": ariaLabel,
}: {
  "aria-label": string;
}) => (
  <PreviousPageButton
    aria-label={ariaLabel}
    className={cn(pageTurnButtonClassName, "start-3")}
  >
    <ViewerBackwardIcon />
  </PreviousPageButton>
);

/** Turns on a page, from the edge the episode ends at. */
export const ViewerNextPageButton = ({
  "aria-label": ariaLabel,
}: {
  "aria-label": string;
}) => (
  <NextPageButton
    aria-label={ariaLabel}
    className={cn(pageTurnButtonClassName, "end-3")}
  >
    <ViewerForwardIcon />
  </NextPageButton>
);
