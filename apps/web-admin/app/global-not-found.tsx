import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

/** The one locale this document renders, named where `lang` is set from it. */
const NOT_FOUND_LOCALE: Locale = "en";

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
 * The locale is a constant rather than the cookie the tenant layout follows.
 * This document has no layout to resolve a locale in and renders as a static
 * page, so nothing here can name the reader's language. The copy comes from the
 * shared catalog, which carries every locale, so the constant chooses a
 * language rather than reporting one: `en` is the repository's default for a
 * page that has no reader-specific answer to give.
 */
export const metadata: Metadata = {
  description: sharedMessage(
    "admin.not_found.metadata_description",
    NOT_FOUND_LOCALE
  ),
  title: sharedMessage("admin.not_found.title", NOT_FOUND_LOCALE),
};

const GlobalNotFound = () => (
  <html lang={NOT_FOUND_LOCALE}>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">
          404 Not Found
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {sharedMessage("admin.not_found.title", NOT_FOUND_LOCALE)}
        </h1>
        <p className="mt-4 text-muted-foreground">
          {sharedMessage("admin.not_found.description", NOT_FOUND_LOCALE)}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground transition hover:bg-muted"
            href="/"
          >
            {sharedMessage("admin.common.back_to_dashboard", NOT_FOUND_LOCALE)}
          </Link>
        </div>
      </main>
    </body>
  </html>
);

export default GlobalNotFound;
