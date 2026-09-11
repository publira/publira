"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";

/**
 * Failure body for a route whose **whole** content is one read — the detail
 * routes, where an `ok: false` leaves nothing to show around it.
 *
 * A section that is one part of a larger page renders `SectionError` instead,
 * so the rest of the page stays; this is for the case where the section *is*
 * the page. Both come from the same `ok: false` value, because a cached read
 * reports failure as a value rather than throwing.
 *
 * It renders `ErrorScreen`, the same body `(site)/error.tsx` does. A reader who
 * loses a whole page sees one screen whichever renderer produced it, and the
 * copy it leads with is that boundary's own title. There is no digest here: a
 * classified `ok: false` never reached a boundary, so no identifier was caught.
 */
export const PageLoadError = ({ description }: { description: string }) => {
  const router = useRouter();
  const onRetry = useCallback(() => {
    // Re-fetches this route from the server; the cached read is retried because
    // a failed `"use cache"` fill is never stored (see
    // `@publira/utils/cached-read`).
    router.refresh();
  }, [router]);

  return (
    <ErrorScreen
      description={description}
      retry={onRetry}
      retryLabel={<ClientMessage message="host.common.retry" />}
      title={<ClientMessage message="host.errors.page_title" />}
    />
  );
};
