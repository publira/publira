import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";

import { SectionErrorCatch } from "./section-error-catch";

interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** Names the section that is missing: 「テナント一覧を表示できませんでした」. */
  title: ReactNode;
}

/**
 * Section-level error boundary for the platform console. Wrap a
 * section's `<Suspense>` with it, so `retry()` puts that section's own skeleton
 * back while the re-run is in flight.
 *
 * `title` is the one node the page passes in, because it names what that
 * section was showing. What the operator can do about it, the retry button, and
 * the digest label say the same thing at every boundary — they belong to the
 * frame, not to the section — so this component resolves them from the catalog
 * itself. Resolving them here also keeps them off the `@publira/ui-components`
 * Japanese defaults, which would read as Japanese on an English console.
 *
 * This is the component-level counterpart of `(protected)/error.tsx`, and it
 * takes the same throws that one does: the lib layer classifies what it can
 * (`ok: false` with a message the screen renders through `SectionError`) and
 * `rethrowUnclassifiedRpcError()` re-throws the rest. The difference is reach —
 * an operator loses one card here instead of the whole console page.
 */
export const SectionErrorBoundary = ({
  children,
  title,
}: SectionErrorBoundaryProps) => (
  <SectionErrorCatch
    description={
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="platform.common.retry_later" />
      </Suspense>
    }
    digestLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
        <Message message="platform.common.error_id" />
      </Suspense>
    }
    retryLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="platform.common.retry" />
      </Suspense>
    }
    title={title}
  >
    {children}
  </SectionErrorCatch>
);
