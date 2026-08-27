import { getMessage } from "@publira/i18n";
import type { Metadata } from "next";
import Link from "next/link";

import ja from "../../../locales/ja.json";

import "./globals.css";

/**
 * App-wide 404 for URLs that match no route at all. Next.js skips the normal
 * layout tree (including `app/[tenant_id]/layout.tsx`) and renders this full
 * HTML document directly, so no tenant RPC runs here.
 *
 * Contrast with `(protected)/not-found.tsx`, which handles `notFound()` for
 * resources under a signed-in console session and keeps the console chrome.
 *
 * Requires `experimental.globalNotFound` in `next.config.ts`. Styles and brand
 * tokens are imported here because this file bypasses the tenant root layout.
 * Tenant-specific `/theme.css` is intentionally omitted: there is no tenant
 * context on an unmatched URL.
 *
 * `lang` stays `ja` rather than following the locale cookie the way the tenant
 * layout does. This document has no layout to resolve a locale in and renders
 * as a static page, so its copy cannot follow the cookie either — pointing the
 * attribute at `en` would only mislabel the Japanese text below.
 */
export const metadata: Metadata = {
  description: getMessage(ja, "admin.not_found.metadata_description"),
  title: getMessage(ja, "admin.not_found.title"),
};

const GlobalNotFound = () => (
  <html lang="ja">
    <body className="min-h-dvh bg-background text-foreground antialiased">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">
          404 Not Found
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {getMessage(ja, "admin.not_found.title")}
        </h1>
        <p className="mt-4 text-muted-foreground">
          {getMessage(ja, "admin.not_found.description")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground transition hover:bg-muted"
            href="/"
          >
            {getMessage(ja, "admin.common.back_to_dashboard")}
          </Link>
        </div>
      </main>
    </body>
  </html>
);

export default GlobalNotFound;
