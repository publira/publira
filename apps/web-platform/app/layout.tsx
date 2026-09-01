import "./globals.css";
import { LOCALE_LANG_SCRIPT } from "@publira/i18n";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Publira Platform Console",
    template: "%s | Publira Platform Console",
  },
};

/**
 * `lang` is left unset and written by the inline script before the browser
 * paints.
 *
 * The console keeps its locale in a cookie rather than in the URL, and under
 * Cache Components a `cookies()` read here would leave every route without a
 * static shell — there is no child `<Suspense>` boundary an `<html>` attribute
 * could move into. So the document ships without a `lang`, and the script sets
 * it from the cookie while the page is still being parsed;
 * `suppressHydrationWarning` is what lets the DOM the script produced win over
 * what React rendered. Naming a language here instead would be a guess, and a
 * wrong `lang` tells a screen reader to pronounce the page in a language it is
 * not written in — worse than saying nothing. The script's source and the
 * reasoning behind it live in `@publira/i18n`.
 */
const RootLayout = ({ children }: LayoutProps<"/">) => (
  <html suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: LOCALE_LANG_SCRIPT }} />
    </head>
    <body className="min-h-dvh antialiased">{children}</body>
  </html>
);

export default RootLayout;
