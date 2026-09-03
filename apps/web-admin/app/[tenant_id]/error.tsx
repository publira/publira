"use client";

import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";

/**
 * Error boundary for the tenant segment itself. It catches what
 * `(protected)/error.tsx` cannot: failures raised while rendering
 * `(protected)/layout.tsx` — `getTenantId()`, `getTenantForSession()` — and the
 * unauthenticated routes (`/login`, `/accept-invite`, …) that sit directly
 * under `[tenant_id]` with no group layout of their own.
 *
 * Because the failing layout is what supplies the sidebar and header, this
 * screen renders bare inside `app/[tenant_id]/layout.tsx`. Tenant colours come
 * from `/theme.css`, which is a stylesheet link and therefore unaffected by a
 * render failure; when that route itself is down the page falls back to the
 * brand defaults in `globals.css`.
 *
 * A failure in `app/[tenant_id]/layout.tsx` (the root layout) is above this
 * boundary; catching it would need a `global-error.tsx`, which this app does
 * not have.
 *
 * Measured against `next dev` by throwing from `(protected)/layout.tsx`: a
 * direct hit renders this screen, with no console chrome, as intended. The
 * production build was measured the same way an admin API outage
 * exercises it — `(protected)/layout.tsx` reads session and tenant, so the
 * outage fails that layout and this screen answers a direct hit with HTTP 200,
 * and 再試行 recovers once the API is back
 * (`e2e/tests/admin.error-boundary.spec.ts`). The limit is the one
 * `(protected)/error.tsx` records: a throw in the first synchronous pass, before
 * the static shell is flushed, aborts the response as a bare 500 that no
 * boundary can catch.
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
          <ClientMessage message="admin.errors.root_description" />
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
        <Suspense fallback={<SkeletonLine className="h-8 w-80" />}>
          <ClientMessage message="admin.errors.root_title" />
        </Suspense>
      }
    />
  </main>
);

export default TenantError;
