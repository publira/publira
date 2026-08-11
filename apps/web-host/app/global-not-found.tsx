import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

/**
 * App-wide 404 for URLs that match no route at all. Next.js skips the normal
 * layout tree (including `app/[tenant_id]/layout.tsx`) and renders this full
 * HTML document directly, so no tenant RPC runs here.
 *
 * Contrast with `(site)/not-found.tsx`, which handles `notFound()` for resources
 * under a resolved tenant and keeps the site chrome.
 *
 * Requires `experimental.globalNotFound` in `next.config.ts`. Styles and brand
 * tokens are imported here because this file bypasses the tenant root layout.
 * Tenant-specific `/theme.css` is intentionally omitted: there is no tenant
 * context on an unmatched URL.
 */
export const metadata: Metadata = {
  description:
    "お探しのページは削除されたか、URL が変更された可能性があります。",
  title: "ページが見つかりません",
};

const GlobalNotFound = () => (
  <html lang="ja">
    <body className="min-h-dvh bg-background text-foreground antialiased">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <p className="text-sm tracking-wide uppercase text-muted-foreground">
          404 Not Found
        </p>
        <h1 className="mt-4 font-serif text-4xl font-bold">
          ページが見つかりません
        </h1>
        <p className="mt-4 text-muted-foreground">
          お探しのページは削除されたか、URL が変更された可能性があります。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
            href="/"
          >
            トップへ戻る
          </Link>
        </div>
      </main>
    </body>
  </html>
);

export default GlobalNotFound;
