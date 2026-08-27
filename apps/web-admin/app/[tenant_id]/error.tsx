"use client";

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
 * boundary and still needs `global-error.tsx` — tracked in #642.
 *
 * Measured against `next dev` by throwing from `(protected)/layout.tsx`: a
 * direct hit renders this screen, with no console chrome, as intended. The
 * production build was measured for #683 the same way an admin API outage
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
      description="admin.errors.root_description"
      digest={error.digest}
      retry={retry}
      title="admin.errors.root_title"
    />
  </main>
);

export default TenantError;
