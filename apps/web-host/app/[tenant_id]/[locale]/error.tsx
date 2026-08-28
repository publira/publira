"use client";

import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";

/**
 * Error boundary for the locale segment itself. It catches what the `(site)` /
 * `(auth)` boundaries cannot: failures raised while rendering those group
 * layouts — tenant resolution, `getTenantSiteInfo()`, the footer link fetch.
 *
 * Because the failing layout is what supplies the header and footer, this
 * screen renders bare inside `app/[tenant_id]/[locale]/layout.tsx`. Tenant
 * colours come from `/theme.css`, which is a stylesheet link and therefore
 * unaffected by a render failure; when that route itself is down the page falls
 * back to the brand defaults in `globals.css`.
 *
 * A failure in `app/[tenant_id]/[locale]/layout.tsx` (the root layout) is above
 * this boundary and still needs `global-error.tsx` — tracked in #642.
 *
 * That position is also why every string below sits behind its own
 * `<Suspense>`: nothing above this boundary can absorb a suspend, and
 * `<ClientMessage>` suspends while it loads the catalog. Without a fallback to
 * flush, React cuts the response short after the 200 is already committed and
 * the reader gets the browser's own network-error page instead of this screen.
 *
 * A public API outage is not what brings this up: every read those group
 * layouts make reports failure as a value — `getTenantSiteInfo()` answers
 * `null`, `listPublishedPageLinks()` answers `[]` — so the site keeps
 * answering 200 with its chrome degraded to the defaults. What reaches here is
 * a throw, which in practice means a bug rather than an unavailable backend.
 *
 * Same reach rule as `(site)/error.tsx` (#683): a failure raised once the
 * static shell has been flushed reaches this boundary on a direct hit too,
 * while one raised in the first synchronous pass aborts the response as a bare
 * `500 Internal Server Error` that no boundary — and no `global-error.tsx` —
 * can catch. See `e2e/tests/catalog.error-boundary.spec.ts`.
 */
const TenantError = ({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) => (
  // The failing layout is what would normally supply the landmark, so this
  // boundary owns the `<main>` element itself.
  <main>
    <ErrorScreen
      description={
        <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
          <ClientMessage message="host.errors.site_description" />
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
          <ClientMessage message="host.errors.site_title" />
        </Suspense>
      }
    />
  </main>
);

export default TenantError;
