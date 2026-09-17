"use client";

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
 * this boundary; catching it would need a `global-error.tsx`, which this app
 * does not have. That layout is also what places `<HostMessagesProvider>`, so
 * the copy here comes from the same catalog as every other screen, whichever
 * group layout failed.
 *
 * A public API outage is not what brings this up: every read those group
 * layouts make reports failure as a value — `getTenantSiteInfo()` answers
 * `null`, `listPublishedPageLinks()` answers `[]` — so the site keeps
 * answering 200 with its chrome degraded to the defaults. What reaches here is
 * a throw, which in practice means a bug rather than an unavailable backend.
 *
 * Same reach rule as `(site)/error.tsx`: a failure raised once the
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
      description={<ClientMessage message="host.errors.site_description" />}
      digest={error.digest}
      digestLabel={<ClientMessage message="host.common.error_id" />}
      retry={retry}
      retryLabel={<ClientMessage message="host.common.retry" />}
      title={<ClientMessage message="host.errors.site_title" />}
    />
  </main>
);

export default TenantError;
