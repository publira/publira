"use client";

import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";

/**
 * Error boundary for the platform console pages. It wraps the pages and nested
 * layouts under `(protected)` but not `(protected)/layout.tsx` itself, so the
 * sidebar and header keep rendering here; a failure raised while rendering that
 * layout — `PlatformUser` / `getPlatformCurrentOperator()` — falls through to
 * `app/error.tsx`.
 *
 * ## Which boundary takes an unclassifiable RPC error
 *
 * This one, for everything a page reads. The lib layer already decides what
 * never gets this far: `rethrowUnclassifiedRpcError()` re-throws `internal` /
 * `unimplemented` and any non-RPC throw, while classified failures become
 * either a message the screen renders inline (`ok: false`) or a `null` the page
 * turns into `notFound()`. So the throws that land here are exactly the ones no
 * copy in `rpcErrorMessage`'s table describes, and "Please try again later."
 * with a digest is the honest answer for them.
 *
 * The two neighbours stay where they are. Failures a form can act on — invalid
 * input, conflicts — remain inline `FormMessage`s next to the control, and the
 * list screens keep rendering their `ok: false` message inside the page rather
 * than replacing it — through the shared `SectionError`, so the copy matches
 * what a boundary would show.
 *
 * `SectionErrorBoundary` also narrows this boundary's reach: a section wrapped
 * in one takes its own throws, so only a failure outside every such boundary
 * replaces the whole console page.
 *
 * No `<main>` here: `ConsoleLayoutMain` already provides one.
 *
 * Each string sits behind its own `<Suspense>` because `<ClientMessage>`
 * suspends while it loads the catalog, and an error boundary cannot rely on
 * finding a boundary above it to absorb that — the neighbouring `app/error.tsx`
 * has none at all, and a suspend with no fallback to flush cuts the response
 * short after the 200 is committed. The `<Suspense>` also keeps the sizing of
 * each fallback visible next to the string it stands in for.
 *
 * The response status stays 200 for the same reason a `notFound()` does — see
 * `not-found.tsx`.
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
          <ClientMessage message="platform.common.back_to_dashboard" />
        </Suspense>
      </LinkButton>
    }
    description={
      <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
        <ClientMessage message="platform.errors.console_description" />
      </Suspense>
    }
    digest={error.digest}
    digestLabel={
      <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
        <ClientMessage message="platform.common.error_id" />
      </Suspense>
    }
    retry={retry}
    retryLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <ClientMessage message="platform.common.retry" />
      </Suspense>
    }
    title={
      <Suspense fallback={<SkeletonLine className="h-8 w-72" />}>
        <ClientMessage message="platform.errors.console_title" />
      </Suspense>
    }
  />
);

export default ConsoleError;
