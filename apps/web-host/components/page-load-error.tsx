"use client";

import { Button } from "@publira/ui-components/button";
import { SectionError } from "@publira/ui-components/section-error";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Failure body for a **blocking** segment — a route that awaits its read
 * outside `<Suspense>` (`instant = false`) so a missing resource can answer a
 * real HTTP 404.
 *
 * Such a route has no static shell in flight when the read fails, so neither
 * `SectionErrorBoundary` nor `(site)/error.tsx` can take over and the response
 * is a bare `500 Internal Server Error` document (#672). The page therefore
 * holds the failure as an `ok: false` value and renders it, which is the
 * "classified result with a message" row of the table in `apps/AGENTS.md`.
 *
 * A section that lives inside `<Suspense>` must keep using
 * `SectionErrorBoundary` instead: its throw does reach the boundary, and only
 * that section is replaced.
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
      <SectionError
        actions={
          <Button onClick={onRetry} size="sm" variant="outline">
            再試行
          </Button>
        }
        description={description}
        title="ページを表示できませんでした"
      />
    </div>
  );
};
