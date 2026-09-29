"use client";

import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminPageActions,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { ErrorBoundaryMessage } from "#components/error-boundary-message";
import {
  ErrorScreen,
  ErrorScreenDigest,
  ErrorScreenRetry,
} from "#components/error-screen";

/**
 * Error boundary for the tenant segment itself. It catches what
 * `(protected)/error.tsx` cannot: failures raised by the console chrome
 * `(protected)/layout.tsx` renders — `getTenantId()`, `getTenantForSession()` —
 * and the unauthenticated routes (`/login`, `/accept-invite`, …) that sit directly
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
 * exercises it — the chrome reads session and tenant, so the outage fails that
 * layout and this screen answers a direct hit with HTTP 200,
 * and Retry recovers once the API is back
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
    <ErrorScreen digest={error.digest} retry={retry}>
      <AdminPageHeader>
        <AdminPageHeading>
          <AdminPageTitle>
            <Suspense fallback={<SkeletonLine className="h-8 w-80" />}>
              <ErrorBoundaryMessage message="admin.errors.root_title" />
            </Suspense>
          </AdminPageTitle>
          <AdminPageDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <ErrorBoundaryMessage message="admin.errors.root_description" />
            </Suspense>
          </AdminPageDescription>
        </AdminPageHeading>
        <AdminPageActions>
          <ErrorScreenRetry>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ErrorBoundaryMessage message="admin.common.retry" />
            </Suspense>
          </ErrorScreenRetry>
        </AdminPageActions>
      </AdminPageHeader>
      <ErrorScreenDigest>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <ErrorBoundaryMessage message="admin.common.error_id" />
        </Suspense>
      </ErrorScreenDigest>
    </ErrorScreen>
  </main>
);

export default TenantError;
