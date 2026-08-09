"use client";

import Link from "next/link";

import { ErrorScreen } from "#components/error-screen";

/**
 * Error boundary for the tenant site pages. It wraps the pages and nested
 * layouts under `(site)` but not `(site)/layout.tsx` itself, so the header and
 * footer keep rendering here; a failure in that layout falls through to
 * `app/[tenant_id]/error.tsx`.
 *
 * Per-section degradation on the catalog top page is a separate concern and
 * moves to `catchError` boundaries in #647.
 *
 * No `<main>` here: `SiteLayoutMain` already provides one.
 *
 * Reach, as measured against the production build: this renders on a client
 * navigation when the page throws and `(site)/layout.tsx` still succeeds. A
 * direct hit answers a bare `500 Internal Server Error` instead, and so does a
 * client navigation when the layout throws too. `app/[tenant_id]` being the
 * root layout is why Next.js has no document to render error UI into on the
 * server; #646 owns that restructuring, and
 * `e2e/tests/catalog.error-boundary.spec.ts` records the measurements and holds
 * the target assertions.
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
      <Link
        className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        href="/"
      >
        トップへ戻る
      </Link>
    }
    description="時間をおいて再試行してください。繰り返す場合はしばらく経ってからアクセスしてください。"
    digest={error.digest}
    retry={retry}
    title="ページを表示できませんでした"
  />
);

export default SiteError;
