import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

/** The one locale this document renders, named where `lang` is set from it. */
const NOT_FOUND_LOCALE: Locale = "ja";

/**
 * App-wide 404 for URLs that match no route at all. Next.js skips the normal
 * layout tree (including `app/[tenant_id]/[locale]/layout.tsx`) and renders
 * this full HTML document directly, so no tenant RPC runs here.
 *
 * Contrast with `(site)/not-found.tsx`, which handles `notFound()` for resources
 * under a resolved tenant and keeps the site chrome.
 *
 * Requires `experimental.globalNotFound` in `next.config.ts`. Styles and brand
 * tokens are imported here because this file bypasses the tenant root layout.
 * Tenant-specific `/theme.css` is intentionally omitted: there is no tenant
 * context on an unmatched URL.
 *
 * The locale is a constant rather than the `[locale]` segment every other page
 * follows. An unmatched URL never reached `proxy.ts`'s rewrite, so there is no
 * tenant behind it and no saved default language to word this page in, and this
 * document renders as a static page with no layout to resolve one in. Naming
 * the language the copy below is actually written in is the only honest
 * attribute available; pointing `lang` at anything else would only mislabel it.
 */
export const metadata: Metadata = {
  description: sharedMessage(
    "host.errors.not_found_description",
    NOT_FOUND_LOCALE
  ),
  title: sharedMessage("host.errors.not_found_title", NOT_FOUND_LOCALE),
};

const GlobalNotFound = () => (
  <html lang={NOT_FOUND_LOCALE}>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">
          404 Not Found
        </p>
        <h1 className="mt-4 font-serif text-4xl font-bold">
          {sharedMessage("host.errors.not_found_title", NOT_FOUND_LOCALE)}
        </h1>
        <p className="mt-4 text-muted-foreground">
          {sharedMessage("host.errors.not_found_description", NOT_FOUND_LOCALE)}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
            href="/"
          >
            {sharedMessage("host.common.back_to_top", NOT_FOUND_LOCALE)}
          </Link>
        </div>
      </main>
    </body>
  </html>
);

export default GlobalNotFound;
