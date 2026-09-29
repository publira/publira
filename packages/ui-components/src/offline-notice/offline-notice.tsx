"use client";

import { WifiOffIcon } from "@publira/icons";
import { useOffline } from "next/offline";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Floats a notice at the top of the viewport while Next.js reports the
 * connection as gone.
 *
 * The live region stays mounted and only its contents change, since a region
 * inserted with its text already in it is not announced. It is a bare
 * `aria-live` rather than `role="status"` so a screen's own form message stays
 * the one status on the page.
 *
 * It is held open as a manual popover, which renders it in the top layer: a
 * `position: fixed` element elsewhere in the document is not painted at all
 * while another element — the episode viewer — is full screen. The layout the
 * classes describe is the one the popover user agent styles would otherwise
 * replace, hence the resets among them.
 */
export const OfflineNotice = ({ children }: { children: ReactNode }) => {
  const isOffline = useOffline();
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const notice = noticeRef.current;
    if (notice === null) {
      return;
    }

    // The top layer stacks in the order it was entered, so an element that
    // goes full screen lands above a popover already open. Showing this one
    // again is what puts it back on top.
    const raise = () => {
      notice.togglePopover(false);
      notice.togglePopover(true);
    };

    raise();
    document.addEventListener("fullscreenchange", raise);

    return () => {
      document.removeEventListener("fullscreenchange", raise);
    };
  }, []);

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 bottom-auto z-[80] m-0 flex w-auto justify-center overflow-visible border-0 bg-transparent px-4 py-0"
      popover="manual"
      ref={noticeRef}
    >
      {isOffline ? (
        <span className="flex items-center gap-2 rounded-surface border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-floating">
          <WifiOffIcon aria-hidden="true" className="size-4 shrink-0" />
          {children}
        </span>
      ) : null}
    </div>
  );
};
