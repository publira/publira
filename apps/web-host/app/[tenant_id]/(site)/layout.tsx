import {
  SiteLayout,
  SiteLayoutActions,
  SiteLayoutBrand,
  SiteLayoutFooter,
  SiteLayoutHeader,
  SiteLayoutHeaderActions,
  SiteLayoutMain,
  SiteLayoutNav,
  getAuthActions,
} from "@publira/layouts";
import type { LayoutLinkItem } from "@publira/layouts";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

const siteNavItems: LayoutLinkItem[] = [
  { href: "/authors", label: "Authors" },
  { href: "/labels", label: "Labels" },
  { href: "/series", label: "Series" },
];

const getHeaderActionsContent = async () => {
  const cookieStore = await cookies();
  const hasSession = Boolean(
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );
  const actions = getAuthActions(hasSession);

  return (
    <SiteLayoutActions
      primaryAction={actions.primaryAction}
      secondaryAction={actions.secondaryAction}
    />
  );
};

const buildSiteTitleBase = (siteLabel: string): string => siteLabel;

const resolveTenantInfo = async () => {
  const tenantId = await getTenantId();
  return getTenantSiteInfo(tenantId);
};

const getAppLabel = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  return tenantInfo?.siteLabel?.trim() || undefined;
};

const getCopyrightText = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  return tenantInfo?.copyrightText?.trim() || undefined;
};

const getFooterNote = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const tenantInfo = await tenantInfoPromise;
  return tenantInfo?.siteDescription?.trim() || undefined;
};

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const info = await getTenantSiteInfo(tenantId);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteDescription = info?.siteDescription?.trim() || undefined;
  const base = buildSiteTitleBase(siteLabel);

  return {
    description: siteDescription,
    openGraph: {
      description: siteDescription,
      title: base,
    },
    title: {
      default: base,
      template: `%s | ${base}`,
    },
  };
};

const TenantLayout = ({ children }: LayoutProps<"/[tenant_id]">) => {
  const tenantInfoPromise = resolveTenantInfo();

  return (
    <SiteLayout>
      <SiteLayoutHeader>
        <SiteLayoutBrand label={getAppLabel(tenantInfoPromise)} />
        <SiteLayoutNav items={siteNavItems} />
        <SiteLayoutHeaderActions content={getHeaderActionsContent()} />
      </SiteLayoutHeader>
      <SiteLayoutMain>{children}</SiteLayoutMain>
      <SiteLayoutFooter
        copyrightText={getCopyrightText(tenantInfoPromise)}
        footerNote={getFooterNote(tenantInfoPromise)}
      />
    </SiteLayout>
  );
};

export default TenantLayout;
