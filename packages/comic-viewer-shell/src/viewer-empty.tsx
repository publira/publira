"use client";

import { useViewerContext } from "@publira/comic-viewer";
import type { ReactNode } from "react";

/**
 * Says, over the mat, that the episode has no pages, where the rail would
 * otherwise leave the mat bare. It renders nothing while there is a page.
 */
export const ViewerEmpty = ({ children }: { children: ReactNode }) => {
  const { pageCount } = useViewerContext();

  return pageCount === 0 ? (
    <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-viewer-ink">
      {children}
    </p>
  ) : null;
};
