"use client";

import { Root } from "@publira/comic-viewer";
import type { ReadingDirection, ViewerPage } from "@publira/comic-viewer";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { acceptNegotiatedImages, createImageFetchPlugin } from "./viewer-fetch";
import type { RenewPageUrl } from "./viewer-fetch";

const VIEWER_PLUGINS = [acceptNegotiatedImages];

/**
 * The viewer root, painted in the colours the app names (see `styles.css`)
 * and fetching every page through {@link createImageFetchPlugin}, so a page
 * reaches the canvas resized and, where it was delivered encrypted, decrypted.
 *
 * `readingDirection` and `spreadStartIndex` are the episode's own layout,
 * already resolved by the caller, so the shell does not pick a default.
 *
 * `renewPageUrl` answers a fresh URL for a page image-server refused, for a
 * viewer that stays open longer than the media tokens in its URLs last (see
 * {@link createImageFetchPlugin}). Pass a stable function: a new one rebuilds
 * the fetch plugin.
 */
export const ViewerRoot = ({
  children,
  initialPageIndex = 0,
  pages,
  readingDirection,
  renewPageUrl,
  spreadStartIndex,
}: {
  children: ReactNode;
  /** Zero-based page the viewer mounts on. */
  initialPageIndex?: number;
  pages: readonly ViewerPage[];
  readingDirection: ReadingDirection;
  renewPageUrl?: RenewPageUrl;
  spreadStartIndex: number;
}) => {
  const plugins = useMemo(
    () =>
      renewPageUrl === undefined
        ? VIEWER_PLUGINS
        : [createImageFetchPlugin(renewPageUrl)],
    [renewPageUrl]
  );

  return (
    <Root
      className="relative flex size-full min-h-0 min-w-0 touch-pan-y overflow-hidden bg-viewer-mat text-viewer-ink"
      initialIndex={initialPageIndex}
      initialReadingDirection={readingDirection}
      pages={pages}
      plugins={plugins}
      spreadStartIndex={spreadStartIndex}
    >
      {children}
    </Root>
  );
};
