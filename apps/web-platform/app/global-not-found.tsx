import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import { buttonVariants } from "@publira/ui-components/button";
import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

/** The one locale this document renders, named where `lang` is set from it. */
const NOT_FOUND_LOCALE: Locale = "en";

/**
 * App-wide 404 for URLs that match no route at all. Next.js skips the normal
 * layout tree and renders this full HTML document directly.
 *
 * Contrast with `(protected)/not-found.tsx`, which handles `notFound()` for
 * resources under a signed-in operator session and keeps the console chrome.
 *
 * Requires `experimental.globalNotFound` in `next.config.ts`. Styles and brand
 * tokens are imported here because this file bypasses `app/layout.tsx`.
 *
 * The link back is styled from `buttonVariants` rather than rendered as
 * `LinkButton`, which is a client component: this document is static and has
 * nothing else to hydrate.
 *
 * The locale is a constant rather than the cookie the console layout follows.
 * This document has no layout to resolve a locale in and renders as a static
 * page, so nothing here can name the reader's language. The copy comes from the
 * shared catalog, which carries every locale, so the constant chooses a
 * language rather than reporting one: `en` is the repository's default for a
 * page that has no reader-specific answer to give.
 */
export const metadata: Metadata = {
  description: sharedMessage(
    "platform.not_found.metadata_description",
    NOT_FOUND_LOCALE
  ),
  title: sharedMessage("platform.not_found.title", NOT_FOUND_LOCALE),
};

const GlobalNotFound = () => (
  <html lang={NOT_FOUND_LOCALE}>
    <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
      <main className="mx-auto grid max-w-(--measure-prose) gap-4 px-6 py-16">
        <h1 className="font-serif text-3xl leading-tight">
          {sharedMessage("platform.not_found.title", NOT_FOUND_LOCALE)}
        </h1>
        <p className="text-foreground">
          {sharedMessage("platform.not_found.description", NOT_FOUND_LOCALE)}
        </p>
        <div className="mt-2">
          <Link className={buttonVariants({ variant: "outline" })} href="/">
            {sharedMessage(
              "platform.common.back_to_dashboard",
              NOT_FOUND_LOCALE
            )}
          </Link>
        </div>
      </main>
    </body>
  </html>
);

export default GlobalNotFound;
