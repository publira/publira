import { getLocales, LOCALE_LANG_SCRIPT } from "@publira/i18n";
import { OfflineNotice } from "@publira/ui-components/offline-notice";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { guardPlaceholder } from "@publira/utils/next-static-params";
import { STATIC_PARAM_PLACEHOLDER } from "@publira/utils/static-param-placeholder";
import type { Metadata } from "next";
import { tenant_id } from "next/root-params";
import { Suspense } from "react";

import { DocumentLocale } from "#components/document-locale";
import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantName } from "#lib/public-api";
import { isRootParamValue, isTenantIdFormat } from "#lib/tenant-id-format";

import "../../globals.css";

/**
 * Both segments are root parameters, so Cache Components needs at least one
 * value for each. The tenant is a placeholder the guards below turn into a
 * 404, and the locales are a closed set: one shell is prerendered per locale.
 * `proxy.ts` is what chooses among them, from the operator's cookie and the
 * tenant's stored default, and rewrites every page request onto the one it
 * chose; the URL never names it.
 */
export const generateStaticParams = () =>
  getLocales().map((locale) => ({
    locale,
    tenant_id: STATIC_PARAM_PLACEHOLDER,
  }));

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await tenant_id();

  if (!isRootParamValue(tenantId)) {
    return {};
  }

  guardPlaceholder(tenantId);

  // A segment that is not a tenant UUID never went through `proxy.ts`, so there
  // is no tenant behind it to name in a title, and the route below answers
  // 404. Reading the name anyway would read uncached data that this route's
  // otherwise fully prerenderable shell has no `<Suspense>` boundary to hold,
  // which is what Cache Components reports as
  // `blocking-prerender-metadata-dynamic`. Deciding before the read keeps the
  // metadata static, and the not-found page titles itself.
  const normalizedTenantId = tenantId.trim();

  if (!isTenantIdFormat(normalizedTenantId)) {
    return {};
  }

  // Metadata is resolved in its own pass and streamed into the document, so
  // the tenant name read below stays out of the route's static shell.
  const locale = await getLocale();

  // `getTenantName` degrades to `null` when the public API is unavailable, so
  // an outage leaves the console titled "Admin console" instead of failing
  // every route.
  const [t, tenantName] = await Promise.all([
    getMessagesFor(locale),
    getTenantName(normalizedTenantId),
  ]);

  const base = tenantName
    ? t("admin.shell.tenant_title", { name: tenantName })
    : t("admin.shell.title");

  return {
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

/**
 * `lang` is written by scripts rather than rendered, and this layout stays
 * synchronous.
 *
 * This layout reads nothing and awaits nothing: an `<html>` attribute has no
 * child `<Suspense>` boundary a read could move into, so a read here would
 * settle the whole tree before anything below it could flush. So the document
 * ships without a `lang`, and `LOCALE_LANG_SCRIPT` sets it while the document
 * is still being parsed, from the operator's own choice or, failing that, from
 * the tenant default `proxy.ts` published on this response
 * (`@publira/utils/resolved-locale`); `suppressHydrationWarning` is what lets
 * the DOM it produces win over what React rendered. The script runs once per
 * document, and `<DocumentLocale>` applies the same rule again when a change of
 * language remounts this layout.
 *
 * A document that reaches the browser with neither cookie keeps naming no
 * language, which is the honest state: a `lang` the page is not written in
 * tells a screen reader to pronounce it in the wrong language, and that is
 * worse for that reader than none.
 */
const RootLayout = ({ children }: LayoutProps<"/[tenant_id]/[locale]">) => (
  <html suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: LOCALE_LANG_SCRIPT }} />
      {/* Dynamic per-tenant overrides from GET /theme.css (short Cache-Control). */}
      {/* oxlint-disable-next-line next/no-css-tags, react-doctor/nextjs-no-css-link -- runtime tenant theme route */}
      <link href="/theme.css" rel="stylesheet" />
    </head>
    <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
      <DocumentLocale />
      {children}
      <OfflineNotice>
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.shell.offline" />
        </Suspense>
      </OfflineNotice>
    </body>
  </html>
);

export default RootLayout;
