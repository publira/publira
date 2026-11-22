"use client";

import * as ConsolePage from "@publira/layouts/admin/console-page";

import { ClientMessage } from "#components/client-message";
import * as ErrorScreen from "#components/error-screen";

/**
 * Error boundary for the tenant segment itself. It catches what
 * `(protected)/error.tsx` cannot: failures raised by the console chrome
 * `(protected)/layout.tsx` renders — `getTenantId()`, `verifyAdminSession()` —
 * and the unauthenticated routes (`/login`, `/accept-invite`, …) that sit
 * directly under `[tenant_id]/[locale]` with no group layout of their own.
 *
 * Because the failing layout is what supplies the sidebar and header, this
 * screen renders bare inside `app/[tenant_id]/[locale]/layout.tsx`. Tenant
 * colours come from `/theme.css`, which is a stylesheet link and therefore
 * unaffected by a render failure; when that route itself is down the page
 * falls back to the brand defaults in `globals.css`.
 *
 * A failure in `app/[tenant_id]/[locale]/layout.tsx` itself is above this
 * boundary; catching it would need a `global-error.tsx`, which this app does
 * not have. That layout places `<AdminLocaleProvider>`, so the copy here comes
 * from the same catalog as every other screen. The read depends only on the
 * `[locale]` root parameter, which is why the strings need no `<Suspense>` and
 * the browser loads no catalog of its own.
 *
 * Measured against `next dev` by throwing from `(protected)/layout.tsx`: a
 * direct hit renders this screen, with no console chrome, as intended. The
 * production build was measured the same way an admin API outage exercises
 * it — the chrome reads session and tenant, so the outage fails that layout
 * and this screen answers a direct hit with HTTP 200, and Retry recovers once
 * the API is back (`e2e/tests/admin.error-boundary.spec.ts`). The limit is the
 * one `(protected)/error.tsx` records: a throw in the first synchronous pass,
 * before the static shell is flushed, aborts the response as a bare 500 that
 * no boundary can catch.
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
    <ErrorScreen.Root digest={error.digest} retry={retry}>
      <ConsolePage.Header>
        <ConsolePage.Heading>
          <ConsolePage.Title>
            <ClientMessage message="admin.errors.root_title" />
          </ConsolePage.Title>
          <ConsolePage.Description>
            <ClientMessage message="admin.errors.root_description" />
          </ConsolePage.Description>
        </ConsolePage.Heading>
        <ConsolePage.Actions>
          <ErrorScreen.Retry>
            <ClientMessage message="admin.common.retry" />
          </ErrorScreen.Retry>
        </ConsolePage.Actions>
      </ConsolePage.Header>
      <ErrorScreen.Digest>
        <ClientMessage message="admin.common.error_id" />
      </ErrorScreen.Digest>
    </ErrorScreen.Root>
  </main>
);

export default TenantError;
