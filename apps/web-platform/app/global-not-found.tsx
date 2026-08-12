import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

/**
 * App-wide 404 for URLs that match no route at all. Next.js skips the normal
 * layout tree and renders this full HTML document directly.
 *
 * Contrast with `(protected)/not-found.tsx`, which handles `notFound()` for
 * resources under a signed-in operator session and keeps the console chrome.
 *
 * Requires `experimental.globalNotFound` in `next.config.ts`. Styles and brand
 * tokens are imported here because this file bypasses `app/layout.tsx`.
 */
export const metadata: Metadata = {
  description: "お探しの項目は削除されたか、URL が変更された可能性があります。",
  title: "ページが見つかりません",
};

const GlobalNotFound = () => (
  <html lang="ja">
    <body className="min-h-dvh bg-background text-foreground antialiased">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">
          404 Not Found
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          ページが見つかりません
        </h1>
        <p className="mt-4 text-muted-foreground">
          お探しの項目は削除されたか、URL
          が変更された可能性があります。一覧から選び直してください。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground transition hover:bg-muted"
            href="/"
          >
            ダッシュボードへ戻る
          </Link>
        </div>
      </main>
    </body>
  </html>
);

export default GlobalNotFound;
