import "./globals.css";
import { LOCALE_LANG_SCRIPT } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { OfflineNotice } from "#components/offline-notice";
import { PlatformMessagesProvider } from "#components/platform-messages-provider";

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
 * it while the page is still being parsed, from the operator's own choice or,
 * failing that, from the saved platform default `proxy.ts` published on this
 * response (`@publira/utils/resolved-locale`); `suppressHydrationWarning` is
 * what lets the DOM the script produced win over what React rendered. A
 * document that reaches the browser with neither keeps naming no language: that
 * is the state before setup, and a wrong `lang` tells a screen reader to
 * pronounce the page in a language it is not written in — worse than saying
 * nothing. The script's source and the reasoning behind it live in
 * `@publira/i18n`.
 */
const RootLayout = ({ children }: LayoutProps<"/">) => (
  <html suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: LOCALE_LANG_SCRIPT }} />
    </head>
    <body className="min-h-dvh font-sans antialiased">
      <PlatformMessagesProvider>{children}</PlatformMessagesProvider>
      <OfflineNotice>
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="platform.shell.offline" />
        </Suspense>
      </OfflineNotice>
    </body>
  </html>
);

export default RootLayout;
