"use client";

import { Root } from "@publira/comic-viewer";
import type { ReadingDirection, ViewerPage } from "@publira/comic-viewer";
import type { ReactNode } from "react";

import { acceptNegotiatedImages } from "./viewer-fetch";

const VIEWER_PLUGINS = [acceptNegotiatedImages];

/**
 * The viewer root, painted in the colours the app names (see `styles.css`)
 * and fetching every page through {@link acceptNegotiatedImages}, so a page
 * reaches the canvas resized and, where it was delivered encrypted, decrypted.
 *
 * `readingDirection` and `spreadStartIndex` are the episode's own layout,
 * already resolved by the caller, so the shell does not pick a default.
 */
export const ViewerRoot = ({
  children,
  initialPageIndex = 0,
  pages,
  readingDirection,
  spreadStartIndex,
}: {
  children: ReactNode;
  /** Zero-based page the viewer mounts on. */
  initialPageIndex?: number;
  pages: readonly ViewerPage[];
  readingDirection: ReadingDirection;
  spreadStartIndex: number;
}) => (
  <Root
    className="relative flex size-full min-h-0 min-w-0 touch-pan-y overflow-hidden bg-viewer-mat text-viewer-ink"
    initialIndex={initialPageIndex}
    initialReadingDirection={readingDirection}
    pages={pages}
    plugins={VIEWER_PLUGINS}
    spreadStartIndex={spreadStartIndex}
  >
    {children}
  </Root>
);
