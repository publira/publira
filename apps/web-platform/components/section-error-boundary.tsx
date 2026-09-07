import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";

import {
  SectionErrorCatch,
  SectionErrorDigest,
  SectionErrorRetry,
} from "./section-error-catch";

interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** Names the section that is missing: "Could not display tenants". */
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
 * itself.
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
    fallback={
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>{title}</SectionErrorTitle>
          <SectionErrorDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="platform.common.retry_later" />
            </Suspense>
          </SectionErrorDescription>
        </SectionErrorHeading>
        <SectionErrorActions>
          <SectionErrorRetry>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="platform.common.retry" />
            </Suspense>
          </SectionErrorRetry>
        </SectionErrorActions>
        <SectionErrorDigest>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.common.error_id" />
          </Suspense>
        </SectionErrorDigest>
      </SectionError>
    }
  >
    {children}
  </SectionErrorCatch>
);
