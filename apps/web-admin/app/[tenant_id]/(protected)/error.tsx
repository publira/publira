"use client";

import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";

/**
 * Error boundary for the console pages. It wraps the pages and nested layouts
 * under `(protected)` but not `(protected)/layout.tsx` itself, so the sidebar
 * and header keep rendering here; a failure in that layout — tenant
 * resolution, `getTenantForSession()` — falls through to
 * `app/[tenant_id]/error.tsx`.
 *
 * It catches what the data helpers do not turn into a message:
 * `rethrowUnclassifiedRpcError()` lets `internal` / `unimplemented` and any
 * non-RPC throw reach this boundary instead of collapsing into "Please try
 * again later." Failures a form can act on — invalid input, conflicts — stay
 * inline as `FormMessage`, and a resource the caller cannot see is
 * `notFound()` (see `not-found.tsx`).
 *
 * `SectionErrorBoundary` narrows the reach: a section wrapped in one takes its
 * own throws, so only a failure outside every such boundary — or one in a page
 * that has no suspended section to degrade — replaces the whole console page.
 *
 * No `<main>` here: `ConsoleLayoutMain` already provides one.
 *
 * Reach, as measured against `next dev` by throwing from a page body: a direct
 * hit renders this screen with the sidebar and header intact, after hydration,
 * with the response status left at 200 (see `not-found.tsx` for why the status
 * is already committed). The production build follows the same rule: a failure
 * raised after the static shell has been flushed — every
 * failed read, since they all cross the network — reaches a boundary on a
 * direct hit, while one raised in the first synchronous pass aborts the
 * response as a bare `500 Internal Server Error` that no boundary can catch.
 *
 * Which boundary that is depends on where the read lives, so an admin API
 * outage is not this screen: session and tenant are read in
 * `(protected)/layout.tsx`, above this boundary, and
 * `app/[tenant_id]/error.tsx` answers instead —
 * `e2e/tests/admin.error-boundary.spec.ts` asserts that and the retry that
 * recovers from it. This screen is for a failure inside the pages below.
 */
const ConsoleError = ({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) => (
  <ErrorScreen
    actions={
      <LinkButton render={<Link href="/" />} variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <ClientMessage message="admin.common.back_to_dashboard" />
        </Suspense>
      </LinkButton>
    }
    description={
      <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
        <ClientMessage message="admin.errors.console_description" />
      </Suspense>
    }
    digest={error.digest}
    digestLabel={
      <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
        <ClientMessage message="admin.common.error_id" />
      </Suspense>
    }
    retry={retry}
    retryLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <ClientMessage message="admin.common.retry" />
      </Suspense>
    }
    title={
      <Suspense fallback={<SkeletonLine className="h-8 w-72" />}>
        <ClientMessage message="admin.errors.console_title" />
      </Suspense>
    }
  />
);

export default ConsoleError;
