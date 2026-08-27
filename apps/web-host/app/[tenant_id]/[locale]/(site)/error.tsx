"use client";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";
import { LocaleLink } from "#components/locale-link";

/**
 * Error boundary for the tenant site pages. It wraps the pages and nested
 * layouts under `(site)` but not `(site)/layout.tsx` itself, so the header and
 * footer keep rendering here; a failure in that layout falls through to
 * `app/[tenant_id]/error.tsx`.
 *
 * Per-section degradation is a separate concern and belongs to the
 * `SectionErrorBoundary` each section is wrapped in (#647). A failure that
 * takes the whole route down is what reaches here.
 *
 * No `<main>` here: `SiteLayoutMain` already provides one.
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
        <ClientMessage message="host.common.back_to_top" />
      </LocaleLink>
    }
    description={<ClientMessage message="host.errors.page_description" />}
    digest={error.digest}
    digestLabel={<ClientMessage message="host.common.error_id" />}
    retry={retry}
    retryLabel={<ClientMessage message="host.common.retry" />}
    title={<ClientMessage message="host.errors.page_title" />}
  />
);

export default SiteError;
