import type { Metadata } from "next";

import { DocumentLocale } from "#components/document-locale";
import {
  LocaleProvider,
  TenantDefaultLocaleProvider,
} from "#components/locale-provider";
import { getLocale, tenantDefaultLocale } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SiteChrome } from "./_components/site-chrome";

export const generateMetadata = async (): Promise<Metadata> => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [info, siteLabel] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
  ]);
  const siteDescription = info?.siteDescription?.trim() || undefined;

  return {
    description: siteDescription,
    openGraph: {
      description: siteDescription,
      title: siteLabel,
    },
    title: {
      default: siteLabel,
      template: `%s | ${siteLabel}`,
    },
  };
};

/**
 * Seeds the locale context for everything under `(site)`. The root layout
 * reads nothing, so this is the first place both values enter the tree: the
 * request's locale from the root parameter, and the tenant's stored default
 * from `GetTenant`.
 *
 * Only the first of the two is awaited here. `generateStaticParams` enumerates
 * the locale, so it has a literal value in a prerender, while `[tenant_id]` is
 * a placeholder — one static shell is shared by every tenant — so the tenant's
 * default travels as the read itself, and `<SiteChrome>` awaits it only in the
 * parts that name a locale prefix. `children` are not among them: the page
 * below is prerendered, and a `<LocaleLink>` inside it suspends at the boundary
 * its own section already has.
 *
 * Awaiting the tenant in this body instead costs every route under `(site)` its
 * static shell — Cache Components reports it as `blocking-prerender-runtime` —
 * and `export const instant = false` is not the way out of that
 * (`apps/AGENTS.md`). A read that fails still throws inside this layout's
 * subtree, where `app/[tenant_id]/[locale]/error.tsx` catches it: a `<Suspense>`
 * absorbs the wait, not the failure.
 */
const SiteLayout = async ({
  children,
}: LayoutProps<"/[tenant_id]/[locale]">) => {
  const locale = await getLocale();

  return (
    <LocaleProvider locale={locale}>
      <DocumentLocale locale={locale} />
      <TenantDefaultLocaleProvider defaultLocale={tenantDefaultLocale()}>
        <SiteChrome>{children}</SiteChrome>
      </TenantDefaultLocaleProvider>
    </LocaleProvider>
  );
};

export default SiteLayout;
