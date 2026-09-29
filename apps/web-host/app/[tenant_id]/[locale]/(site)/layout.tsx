import type { Metadata } from "next";

import { DocumentLocale } from "#components/document-locale";
import {
  LocaleProvider,
  TenantDefaultLocaleProvider,
} from "#components/locale-provider";
import { getLocale } from "#lib/locale";
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
 * Awaits nothing, so every route under `(site)` keeps its static shell; the
 * providers hand their reads down unresolved.
 */
const SiteLayout = ({ children }: LayoutProps<"/[tenant_id]/[locale]">) => (
  <LocaleProvider>
    <DocumentLocale />
    <TenantDefaultLocaleProvider>
      <SiteChrome>{children}</SiteChrome>
    </TenantDefaultLocaleProvider>
  </LocaleProvider>
);

export default SiteLayout;
