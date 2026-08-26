import { LOCALES } from "@publira/utils/i18n";
import { STATIC_PARAM_PLACEHOLDER } from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { LocaleProvider } from "#components/locale-provider";
import { getLocale } from "#lib/locale";
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
  LOCALES.map((locale) => ({
    locale,
    tenant_id: STATIC_PARAM_PLACEHOLDER,
  }));

/**
 * Icons live on the root layout rather than on `(site)`, so a reader sees the
 * tenant's own icon on the auth screens too — those are the pages a browser is
 * most likely to bookmark.
 */
export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const info = await getTenantSiteInfo(tenantId);

  return { icons: resolveTenantIcons(info) };
};

/**
 * `lang` comes straight from the URL. The public site keeps its locale in the
 * path rather than in a cookie, so — unlike the two consoles — the attribute
 * is known before the shell is prerendered and needs no inline correction
 * script.
 */
const TenantRootLayout = async ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <head>
        {/* Dynamic per-tenant overrides from GET /theme.css (short Cache-Control). */}
        {/* oxlint-disable-next-line next/no-css-tags, react-doctor/nextjs-no-css-link -- runtime tenant theme route */}
        <link href="/theme.css" rel="stylesheet" />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
};

export default TenantRootLayout;
