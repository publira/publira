"use client";

import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

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
 * non-RPC throw reach this boundary instead of collapsing into
 * 「時間をおいて再試行してください。」. Failures a form can act on — invalid
 * input, conflicts — stay inline as `FormMessage`, and a resource the caller
 * cannot see is `notFound()` (see `not-found.tsx`).
 *
 * Reach narrowed in #647: a section wrapped in `SectionErrorBoundary` takes its
 * own throws, so only a failure outside every such boundary — or one in a page
 * that has no suspended section to degrade — replaces the whole console page.
 *
 * No `<main>` here: `ConsoleLayoutMain` already provides one.
 *
 * Reach, as measured against `next dev` by throwing from a page body: a direct
 * hit renders this screen with the sidebar and header intact, after hydration,
 * with the response status left at 200 (see `not-found.tsx` for why the status
 * is already committed). The production build follows the same rule, measured
 * for #683: a failure raised after the static shell has been flushed — every
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
        <ClientMessage message="admin.common.back_to_dashboard" />
      </LinkButton>
    }
    description="admin.errors.console_description"
    digest={error.digest}
    retry={retry}
    title="admin.errors.console_title"
  />
);

export default ConsoleError;
