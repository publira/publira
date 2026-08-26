import "./globals.css";
import { DEFAULT_LOCALE, LOCALE_LANG_SCRIPT } from "@publira/i18n";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Publira Platform Console",
    template: "%s | Publira Platform Console",
  },
};

/**
 * `lang` is rendered as the default locale and corrected by the inline script
 * before the browser paints.
 *
 * The console keeps its locale in a cookie rather than in the URL, and under
 * Cache Components a `cookies()` read here would leave every route without a
 * static shell — there is no child `<Suspense>` boundary an `<html>` attribute
 * could move into. Reading the cookie in the script instead keeps the shell
 * static; `suppressHydrationWarning` is what lets the DOM the script produced
 * win over the attribute React rendered. The script's source and the reasoning
 * behind it live in `@publira/i18n`.
 */
const RootLayout = ({ children }: LayoutProps<"/">) => (
  <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: LOCALE_LANG_SCRIPT }} />
    </head>
    <body className="min-h-dvh antialiased">{children}</body>
  </html>
);

export default RootLayout;
