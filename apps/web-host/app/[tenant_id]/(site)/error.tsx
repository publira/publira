"use client";

import Link from "next/link";

import { ErrorScreen } from "#components/error-screen";

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
 * Reach, as measured against the production build: this renders on a client
 * navigation when the page throws and `(site)/layout.tsx` still succeeds. A
 * direct hit answers a bare `500 Internal Server Error` instead, and so does a
 * client navigation when the layout throws too. The cause of that 500 is not
 * identified. #683 carries it, and
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
