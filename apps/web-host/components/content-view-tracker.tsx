"use client";

import { useEffect } from "react";

import type { ContentViewKind } from "#lib/view-events";

/**
 * The tenant-scoped endpoint the beacon reaches. `proxy.ts` rewrites `/api/…`
 * onto the resolved tenant, so the reader's URL carries no tenant and no
 * locale segment.
 */
const VIEW_BEACON_PATH = "/api/v1/views";

/**
 * Reports the soft page view for the detail page it is mounted on.
 *
 * The report is a synchronization with an external system — the analytics log
 * behind the public API — rather than anything the reader did, so it belongs
 * in an Effect. It renders nothing.
 *
 * Mounting is what makes this the reader's own view: a prefetched page is
 * never mounted, and a page served from the cache is mounted all the same, so
 * neither the prefetch exclusion nor the cache can be answered from the server
 * components that read the same detail.
 *
 * `sendBeacon` hands the request to the browser, which delivers it on its own
 * schedule and keeps it alive across the navigation that may follow straight
 * after. There is nothing to await and nothing to fail: a view the browser
 * could not queue is a view lost, which is a better outcome than a page that
 * stalls or errors over its own instrumentation.
 *
 * Strict Mode sends this twice in development. Nothing guards against that:
 * the API collapses repeats from one actor into a single row for the whole
 * half-hour bucket, so the duplicate costs one 204 and changes no data, and a
 * ref that suppressed it would only be suppressing it in development.
 */
export const ContentViewTracker = ({
  kind,
  publicId,
}: {
  kind: ContentViewKind;
  publicId: string;
}) => {
  useEffect(() => {
    // A JSON body is not a CORS-safelisted content type, so a cross-origin
    // page cannot send this beacon at all — the same-origin check on the
    // endpoint is the guard, and this is the layer above it.
    navigator.sendBeacon(
      VIEW_BEACON_PATH,
      new Blob([JSON.stringify({ kind, publicId })], {
        type: "application/json",
      })
    );
  }, [kind, publicId]);

  return null;
};
