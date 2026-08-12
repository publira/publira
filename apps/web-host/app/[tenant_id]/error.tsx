"use client";

import { ErrorScreen } from "#components/error-screen";

/**
 * Error boundary for the tenant segment itself. It catches what the `(site)` /
 * `(auth)` boundaries cannot: failures raised while rendering those group
 * layouts — tenant resolution, `getTenantSiteInfo()`, the footer link fetch.
 *
 * Because the failing layout is what supplies the header and footer, this
 * screen renders bare inside `app/[tenant_id]/layout.tsx`. Tenant colours come
 * from `/theme.css`, which is a stylesheet link and therefore unaffected by a
 * render failure; when that route itself is down the page falls back to the
 * brand defaults in `globals.css`.
 *
 * A failure in `app/[tenant_id]/layout.tsx` (the root layout) is above this
 * boundary and still needs `global-error.tsx` — tracked in #642.
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
      description="サイトの読み込みに失敗しました。時間をおいて再試行してください。"
      digest={error.digest}
      retry={retry}
      title="サイトを表示できませんでした"
    />
  </main>
);

export default TenantError;
