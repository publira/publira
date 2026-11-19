import "../globals.css";
import { getLocales, LOCALE_LANG_SCRIPT } from "@publira/i18n";
import { OfflineNotice } from "@publira/ui-components/offline-notice";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { DocumentLocale } from "#components/document-locale";
import { Message } from "#components/message";
import { PlatformMessagesProvider } from "#components/platform-messages-provider";
import { platformIcons } from "#lib/brand-icons";
import { getMessages } from "#lib/get-messages";

/**
 * The locale is a root parameter, so Cache Components needs at least one value
 * for it, and the locales are a closed set: one shell is prerendered per
 * locale. `proxy.ts` is what chooses among them, from the operator's cookie
 * and the saved platform default, and rewrites every page request onto the
 * one it chose; the URL never names it.
 */
export const generateStaticParams = () =>
  getLocales().map((locale) => ({ locale }));

// Metadata is resolved in a pass of its own and streams into the document, so
// this read stays out of every route's shell.
export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();
  const title = t("platform.shell.title");

  return {
    icons: platformIcons,
    title: { default: title, template: `%s | ${title}` },
  };
};

/**
 * `lang` is left unset and written by the inline script before the browser
 * paints.
 *
 * This layout reads nothing and awaits nothing: an `<html>` attribute has no
 * child `<Suspense>` boundary a read could move into, so a read here would
 * settle the whole tree before anything below it could flush. So the document
 * ships without a `lang`, and the script sets it while the page is still being
 * parsed, from the operator's own choice or, failing that, from the saved
 * platform default `proxy.ts` published on this response
 * (`@publira/utils/resolved-locale`); `suppressHydrationWarning` is what lets
 * the DOM the script produced win over what React rendered. A document that
 * reaches the browser with neither keeps naming no language: that is the state
 * before setup, and a wrong `lang` tells a screen reader to pronounce the page
 * in a language it is not written in — worse than saying nothing. The script's
 * source and the reasoning behind it live in `@publira/i18n`. The script runs
 * once per document, and `<DocumentLocale>` applies the same rule again when a
 * change of language remounts this layout.
 */
const RootLayout = ({ children }: LayoutProps<"/[locale]">) => (
  <html suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: LOCALE_LANG_SCRIPT }} />
    </head>
    <body className="min-h-dvh font-sans antialiased">
      <DocumentLocale />
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
