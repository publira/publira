import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { HostMessageKey } from "#lib/locale";

/**
 * The four strings every `SectionErrorBoundary` on this site shows: which
 * section is missing, what to do about it, the retry button, and the digest
 * prefix. Only the first differs per section.
 *
 * Spread onto the boundary rather than written out at each one — the copy is
 * identical everywhere and the fallback sizes are a property of this block, not
 * of the page that happens to wrap a section in it:
 *
 * ```tsx
 * <SectionErrorBoundary {...sectionErrorCopy("host.top.recommended_error")}>
 * ```
 *
 * `@publira/ui-components` defaults the last three to Japanese, so a boundary
 * that leaves them out reads as Japanese on an English page.
 */
export const sectionErrorCopy = (title: HostMessageKey) => ({
  description: (
    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
      <Message message="host.errors.page_description" />
    </Suspense>
  ),
  digestLabel: (
    <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
      <Message message="host.common.error_id" />
    </Suspense>
  ),
  retryLabel: (
    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
      <Message message="host.common.retry" />
    </Suspense>
  ),
  title: (
    <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
      <Message message={title} />
    </Suspense>
  ),
});
