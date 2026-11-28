import type { Metadata } from "next";

import { DocumentLocale } from "#components/document-locale";
import {
  LocaleProvider,
  TenantLocalesProvider,
} from "#components/locale-provider";
import { pageOpenGraphMetadata } from "#lib/open-graph";
import { getSiteOpenGraphCard } from "#lib/site-open-graph-card";

import { SiteChrome } from "./_components/site-chrome";

export const generateMetadata = async (): Promise<Metadata> => {
  const site = await getSiteOpenGraphCard();

  return {
    // The tenant's own card, for every page that sets none of its own. It
    // names no URL: whatever page inherits it is not the one it would name.
    ...pageOpenGraphMetadata({
      site,
      alternates: undefined,
      title: site.siteName,
    }),
    description: site.description,
    title: {
      default: site.siteName,
      template: `%s | ${site.siteName}`,
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
