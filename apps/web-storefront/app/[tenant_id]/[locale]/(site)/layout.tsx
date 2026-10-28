import type { Metadata } from "next";

import { DocumentLocale } from "#components/document-locale";
import {
  LocaleProvider,
  TenantLocalesProvider,
} from "#components/locale-provider";
import { getLocale } from "#lib/locale";
import { openGraphCardImage, openGraphMetadata } from "#lib/open-graph";
import { tenantOpenGraphCardPath } from "#lib/open-graph-card-subject";
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SiteChrome } from "./_components/site-chrome";

export const generateMetadata = async (): Promise<Metadata> => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [{ siteDescription }, siteLabel, cardPath] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    tenantOpenGraphCardPath(tenantId, locale, { kind: "site" }),
  ]);

  return {
    // The tenant's own card, for every page that has none of its own.
    ...openGraphMetadata({
      description: siteDescription,
      image: cardPath ? openGraphCardImage(cardPath, siteLabel) : undefined,
      siteName: siteLabel,
      title: siteLabel,
      type: "website",
    }),
    description: siteDescription,
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
    <TenantLocalesProvider>
      <SiteChrome>{children}</SiteChrome>
    </TenantLocalesProvider>
  </LocaleProvider>
);

export default SiteLayout;
