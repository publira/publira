import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";

import { SectionErrorCatch } from "./section-error-catch";

interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** What the reader can do about it, when the section says it better. */
  description?: ReactNode;
  /** Names the section that is missing: 「おすすめ作品を表示できませんでした」. */
  title: ReactNode;
}

/**
 * Section-level error boundary for the tenant site (#647). Wrap a section's
 * `<Suspense>` with it, so `retry()` puts that section's own skeleton back
 * while the re-run is in flight.
 *
 * `title` and `description` are nodes the section passes in, because they name
 * what that section was showing. The retry button and the digest label say the
 * same thing at every boundary — they belong to the frame, not to the section —
 * so this component resolves them from the catalog itself.
 *
 * This is the component-level counterpart of `(site)/error.tsx`: a failure that
 * makes the whole route meaningless still belongs to that one. Pages used to
 * pick between the two with a `try` / `catch` around each read, which is what
 * this replaces. Retiring those `catch` blocks costs nothing that was working —
 * a throw inside a `"use cache"` scope is not observable from the awaiting
 * caller, so in production they never ran and the route answered a bare 500
 * instead (#672). Whether the throw reaches this boundary instead is measured
 * there, not assumed here.
 */
export const SectionErrorBoundary = ({
  children,
  description,
  title,
}: SectionErrorBoundaryProps) => (
  <SectionErrorCatch
    description={description}
    digestLabel={
      <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
        <Message message="host.common.error_id" />
      </Suspense>
    }
    retryLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="host.common.retry" />
      </Suspense>
    }
    title={title}
  >
    {children}
  </SectionErrorCatch>
);
