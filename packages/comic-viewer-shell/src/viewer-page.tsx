"use client";

import {
  PageCanvas,
  usePageLoadState,
  ViewportPage,
} from "@publira/comic-viewer";
import { Button } from "@publira/ui-components/button";
import type { ReactNode } from "react";

/**
 * The page template the rail renders for every managed page. It holds the
 * canvas the viewer draws into, and `children` add the states the canvas
 * cannot show on its own: {@link ViewerPageLoading} and
 * {@link ViewerPageError}.
 */
export const ViewerPage = ({ children }: { children?: ReactNode }) => (
  <ViewportPage className="relative flex size-full min-w-0 items-center justify-center data-[page-side=left]:justify-end data-[page-side=right]:justify-start">
    {/* A preview standing in for the full page is faded back toward the mat. */}
    <PageCanvas className="block h-full max-h-full w-auto max-w-full bg-viewer-mat object-contain group-data-[page-fit-mode=actual]:size-auto group-data-[page-fit-mode=actual]:max-h-none group-data-[page-fit-mode=actual]:max-w-none group-data-[page-fit-mode=width]:h-auto group-data-[page-fit-mode=width]:max-h-none group-data-[page-fit-mode=width]:w-full group-data-[page-fit-mode=width]:max-w-none data-[placeholder]:opacity-70" />
    {children}
  </ViewportPage>
);

/** Shown over a page that has nothing on screen yet. */
export const ViewerPageLoading = ({ children }: { children: ReactNode }) => {
  const { status } = usePageLoadState();

  return status === "loading" ? (
    <p className="absolute inset-0 flex items-center justify-center text-sm text-viewer-ink">
      {children}
    </p>
  ) : null;
};

/**
 * Shown over a page whose fetch or decode failed, holding what went wrong
 * ({@link ViewerPageErrorMessage}) and the control that asks for another
 * attempt ({@link ViewerPageRetryButton}).
 */
export const ViewerPageError = ({ children }: { children: ReactNode }) => {
  const { status } = usePageLoadState();

  return status === "error" ? (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-viewer-mat/90 px-6 text-center"
      role="alert"
    >
      {children}
    </div>
  ) : null;
};

export const ViewerPageErrorMessage = ({
  children,
}: {
  children: ReactNode;
}) => <p className="text-sm text-viewer-ink">{children}</p>;

export const ViewerPageRetryButton = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { retry } = usePageLoadState();

  return (
    // The click stops here. A click near the edge of the viewport turns the
    // page, and an unpaired page keeps the half of the spread its own parity
    // gives it — so this control is drawn inside that zone whenever the page
    // it covers stands alone. Without this the reader would be carried to the
    // next spread by the button they pressed to stay put. The viewport
    // already makes the same exception for keyboard input.
    <Button
      onClick={(event) => {
        event.stopPropagation();
        retry();
      }}
      size="sm"
      variant="outline"
    >
      {children}
    </Button>
  );
};
