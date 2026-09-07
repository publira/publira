"use client";

import { Button } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { ClientMessage } from "#components/client-message";

/**
 * Failure body for a route whose **whole** content is one read — the detail
 * routes, where an `ok: false` leaves nothing to show around it.
 *
 * A section that is one part of a larger page renders `SectionError` instead,
 * so the rest of the page stays; this is for the case where the section *is*
 * the page. Both come from the same `ok: false` value, because a cached read
 * reports failure as a value rather than throwing.
 *
 * The title matches `(site)/error.tsx` on purpose — a reader who loses a whole
 * page should see the same thing whichever renderer produced it.
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
    <div className="mx-auto max-w-3xl px-6 py-24">
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <ClientMessage message="host.errors.page_title" />
          </SectionErrorTitle>
          <SectionErrorDescription>{description}</SectionErrorDescription>
        </SectionErrorHeading>
        <SectionErrorActions>
          <Button onClick={onRetry} size="sm" variant="outline">
            <ClientMessage message="host.common.retry" />
          </Button>
        </SectionErrorActions>
      </SectionError>
    </div>
  );
};
