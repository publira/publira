"use client";

import { useEffect, useRef } from "react";

import { recordContentViewAction } from "#lib/view-event-actions";
import type { ContentViewKind } from "#lib/view-events";

/**
 * Reports the soft page view for the detail page it is mounted on.
 *
 * The report is a synchronization with an external system — the analytics log
 * behind the public API — rather than anything the reader did, so it belongs
 * in an Effect. It renders nothing.
 *
 * Mounting is what makes this the reader's own view: a prefetched page is
 * never mounted, and a page served from the cache is mounted all the same, so
 * neither the prefetch exclusion nor the cache can be answered from the
 * server components that read the same detail.
 */
export const ContentViewTracker = ({
  kind,
  publicId,
  tenantId,
}: {
  kind: ContentViewKind;
  publicId: string;
  tenantId: string;
}) => {
  // Strict Mode mounts twice in development, and a soft navigation back to the
  // same page remounts as well. The API debounces repeats into one row either
  // way; this keeps the redundant round trips off the network.
  const reportedRef = useRef("");

  useEffect(() => {
    const view = `${tenantId}/${kind}/${publicId}`;
    if (reportedRef.current === view) {
      return;
    }
    reportedRef.current = view;
    const report = async () => {
      try {
        await recordContentViewAction({ kind, publicId, tenantId });
      } catch {
        // Instrumentation that could take the page down with it would be
        // worse than instrumentation that loses a view.
      }
    };
    void report();
  }, [kind, publicId, tenantId]);

  return null;
};
