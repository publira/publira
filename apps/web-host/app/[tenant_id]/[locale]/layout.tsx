import { getLocales, PATH_LOCALE_LANG_SCRIPT } from "@publira/i18n";
import { STATIC_PARAM_PLACEHOLDER } from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { getTenantSiteInfo } from "#lib/tenant";
import { resolveTenantIcons } from "#lib/tenant-icon";
import { getTenantId } from "#lib/tenant-id";

import "../../globals.css";

/**
 * Both segments above this layout are root parameters, so both need a value
 * under Cache Components. Tenants are resolved per request from the domain and
 * cannot be enumerated at build time — hence the placeholder every tenant read
 * guards against — while the locales are a closed set and really are
 * prerendered one entry per locale.
 *
 * Every supported locale is emitted, not just the tenant's default one. The
 * default decides where `proxy.ts` sends a URL that names no locale; it does
 * not narrow what the site serves, because the other locale stays reachable by
 * its own URL and every tenant shares these shells anyway — the tenant segment
 * is a placeholder here, so there is no tenant whose setting could be read at
 * build time.
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
 */
export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const info = await getTenantSiteInfo(tenantId);

  return { icons: resolveTenantIcons(info) };
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
 */
const TenantRootLayout = ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => (
  <html suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: PATH_LOCALE_LANG_SCRIPT }} />
      {/* Dynamic per-tenant overrides from GET /theme.css (short Cache-Control). */}
      {/* oxlint-disable-next-line next/no-css-tags, react-doctor/nextjs-no-css-link -- runtime tenant theme route */}
      <link href="/theme.css" rel="stylesheet" />
    </head>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      {children}
    </body>
  </html>
);

export default TenantRootLayout;
