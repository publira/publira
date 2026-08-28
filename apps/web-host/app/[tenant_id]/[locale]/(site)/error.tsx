"use client";

import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";
import { LocaleLink } from "#components/locale-link";

/**
 * Error boundary for the tenant site pages. It wraps the pages and nested
 * layouts under `(site)` but not `(site)/layout.tsx` itself, so the header and
 * footer keep rendering here; a failure in that layout falls through to
 * `app/[tenant_id]/[locale]/error.tsx`.
 *
 * Per-section degradation is a separate concern and belongs to the
 * `SectionErrorBoundary` each section is wrapped in (#647). A failure that
 * takes the whole route down is what reaches here.
 *
 * No `<main>` here: `SiteLayoutMain` already provides one.
 *
 * Each string sits behind its own `<Suspense>` because `<ClientMessage>`
 * suspends while it loads the catalog, and an error boundary cannot rely on
 * finding a boundary above it to absorb that — the neighbouring
 * `app/[tenant_id]/[locale]/error.tsx` has none at all, and a suspend with no
 * fallback to flush cuts the response short after the 200 is committed. The
 * `<Suspense>` also keeps the sizing of each fallback visible next to the
 * string it stands in for.
 *
 * Reach, as measured against the production build (#683): what decides whether
 * this renders is **when** the failure happens, not how the request arrived. A
 * throw raised after the static shell has been flushed — which every failed
 * read is, because they all cross the network — streams into the committed
 * shell and lands here, on a direct hit as well as on a client navigation. A
 * throw raised in the first synchronous pass, before anything is committed,
 * aborts the response with a bare `500 Internal Server Error` that no boundary
 * can reach; Next.js does not fall back to its `__next_error__` document there
 * either, which is why adding `app/global-error.tsx` changed nothing. That last
 * part is upstream behaviour, not wiring to fix here: an on-demand render that
 * throws skips both boundaries (vercel/next.js#62046 for `generateStaticParams`,
 * vercel/next.js#96567 for `"use cache"`), and this build answers plain text
 * rather than #62046's built-in error page only because it has no pages-router
 * `/_error` to fall back to. The measurements live in
 * `e2e/tests/catalog.error-boundary.spec.ts`.
 */
const SiteError = ({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) => (
  <ErrorScreen
    actions={
      <LocaleLink
        className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        href="/"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ClientMessage message="host.common.back_to_top" />
        </Suspense>
      </LocaleLink>
    }
    description={
      <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
        <ClientMessage message="host.errors.page_description" />
      </Suspense>
    }
    digest={error.digest}
    digestLabel={
      <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
        <ClientMessage message="host.common.error_id" />
      </Suspense>
    }
    retry={retry}
    retryLabel={
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <ClientMessage message="host.common.retry" />
      </Suspense>
    }
    title={
      <Suspense fallback={<SkeletonLine className="h-8 w-72" />}>
        <ClientMessage message="host.errors.page_title" />
      </Suspense>
    }
  />
);

export default SiteError;
