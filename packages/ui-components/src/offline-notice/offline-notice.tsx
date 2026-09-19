"use client";

import { WifiOffIcon } from "@publira/icons";
import { useOffline } from "next/offline";
import type { ReactNode } from "react";

/**
 * Floats a notice at the top of the viewport while Next.js reports the
 * connection as gone.
 *
 * The live region stays mounted and only its contents change, since a region
 * inserted with its text already in it is not announced. It is a bare
 * `aria-live` rather than `role="status"` so a screen's own form message stays
 * the one status on the page.
 */
export const OfflineNotice = ({ children }: { children: ReactNode }) => {
  const isOffline = useOffline();

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex justify-center px-4"
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
