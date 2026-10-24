import { getLocales, PATH_LOCALE_LANG_SCRIPT } from "@publira/i18n";
import { OfflineNotice } from "@publira/ui-components/offline-notice";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { STATIC_PARAM_PLACEHOLDER } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { StorefrontMessagesProvider } from "#components/storefront-messages-provider";
import {
  getTenantSiteVerification,
  siteVerificationMetadata,
} from "#lib/site-verification";
import { getTenantPublicOrigin, getTenantSiteInfo } from "#lib/tenant";
import { resolveTenantIcons } from "#lib/tenant-icon";
import { getTenantId } from "#lib/tenant-id";

import { GoogleTag } from "./_components/google-tag";

import "../../globals.css";

/**
 * Both segments above this layout are root parameters, so both need a value
 * under Cache Components. Tenants are resolved per request from the domain and
 * cannot be enumerated at build time — hence the placeholder every tenant read
 * guards against — while the locales are a closed set and really are
 * prerendered one entry per locale.
 *
 * Every registry locale is emitted, not just the ones a tenant offers. Every
 * tenant shares these shells — the tenant segment is a placeholder here, so
 * there is no tenant whose setting could be read at build time — and the
 * narrowing happens per request instead: `proxy.ts` redirects a prefix the
 * tenant does not offer to the unprefixed URL before any shell is served.
 */
export const generateStaticParams = () =>
  getLocales().map((locale) => ({
    locale,
    tenant_id: STATIC_PARAM_PLACEHOLDER,
  }));

/**
 * Icons live on the root layout rather than on `(site)`, so a reader sees the
 * tenant's own icon on the auth screens too — those are the pages a browser is
 * most likely to bookmark. Metadata is resolved in a pass of its own and
 * streamed into the document, so this read stays out of the route's shell.
 *
 * `metadataBase` is the tenant's own domain, so every relative URL a page puts
 * in its metadata — canonical and language alternates, Open Graph — resolves
 * there rather than against the request's `Host`.
 *
 * The search engine verification tags sit here too, so the auth screens carry
 * them as well: a service may check any page of the site, and no page sets
 * `verification` of its own.
 * Each service's verifier, `Google-Site-Verification` and `Bingbot`, is among
 * the user agents Next.js renders metadata into `<head>` for rather than
 * streaming it into `<body>`, and `<head>` is where both look.
 */
export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [info, origin, siteVerification] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantPublicOrigin(tenantId),
    getTenantSiteVerification(tenantId),
  ]);

  return {
    icons: resolveTenantIcons(info),
    metadataBase: origin ? new URL(origin) : undefined,
    verification: siteVerificationMetadata(siteVerification),
  };
};

/**
 * The document shell, and nothing else: this layout reads nothing and awaits
 * nothing. An `<html>` attribute has no child `<Suspense>` boundary a read
 * could move into, so a read here settles the whole tree before anything below
 * it can flush — which is why neither the request's locale nor the tenant's
 * stored default is resolved at this level.
 *
 * `lang` is therefore written rather than rendered, the way both consoles
 * write theirs. `PATH_LOCALE_LANG_SCRIPT` applies, while the document is still
 * being parsed, the locale the path names or — on the unprefixed URL that
 * serves the tenant's default — the default `proxy.ts` published on this
 * response (`@publira/utils/resolved-locale`); `suppressHydrationWarning` is
 * what lets the DOM it produces win over what React rendered.
 *
 * That script runs once per document, so it answers the load and nothing else.
 * A client-side navigation re-renders this element the way the server
 * described it — without `lang` — and `<DocumentLocale>`, seeded beside the
 * locale context in the `(site)` and `(auth)` layouts, is what writes the
 * attribute back afterwards.
 *
 * The React context both locales travel in is seeded one level down, by the
 * `(site)` and `(auth)` layouts. That is also what puts the tenant read behind
 * `app/[tenant_id]/[locale]/error.tsx`: a tenant whose stored default cannot be
 * read now brings up that boundary instead of a bare 500 no boundary catches.
 *
 * `<StorefrontMessagesProvider>` is the exception, because it reads nothing
 * here: it hands the catalog read down unresolved, so the error boundary sits
 * below it too and the provider is not remounted between `(site)` and `(auth)`.
 *
 * The tenant's Google tag is read below this layout as well, inside a
 * `<Suspense>` with no fallback: it renders nothing until it answers, and
 * nothing at all for a tenant that has set no ID.
 *
 * `group/document` never changes. Chrome that answers something deeper in the
 * page — the site header giving way to a wide episode viewer — matches that
 * element with `group-has-*`, so nothing above it has to be told.
 */
const RootLayout = ({ children }: LayoutProps<"/[tenant_id]/[locale]">) => (
  <html suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: PATH_LOCALE_LANG_SCRIPT }} />
      {/* Dynamic per-tenant overrides from GET /theme.css (short Cache-Control). */}
      {/* oxlint-disable-next-line next/no-css-tags, react-doctor/nextjs-no-css-link -- runtime tenant theme route */}
      <link href="/theme.css" rel="stylesheet" />
    </head>
    <body className="group/document min-h-dvh bg-background font-sans text-foreground antialiased">
      <StorefrontMessagesProvider>{children}</StorefrontMessagesProvider>
      <OfflineNotice>
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="storefront.common.offline" />
        </Suspense>
      </OfflineNotice>
      <Suspense fallback={null}>
        <GoogleTag />
      </Suspense>
    </body>
  </html>
);

export default RootLayout;
