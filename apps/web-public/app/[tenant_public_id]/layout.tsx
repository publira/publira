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
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PUBLIC_SESSION_COOKIE_NAME } from "../../lib/auth";
import { getTenantSiteInfo } from "../../lib/tenant";

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

const buildPublicTitleBase = (siteLabel: string): string => siteLabel;

const resolveTenantInfo = async (
  params: Promise<{ tenant_public_id: string }>
) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  return getTenantSiteInfo(tenant_public_id);
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

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const siteLabel = info?.siteLabel ?? "サイト";
  const siteDescription = info?.siteDescription?.trim() || undefined;
  const base = buildPublicTitleBase(siteLabel);

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

export default function TenantLayout({
  children,
  params,
}: LayoutProps<"/[tenant_public_id]">) {
  const tenantInfoPromise = resolveTenantInfo(params);

  return (
    <SiteLayout>
      <SiteLayoutHeader>
        <SiteLayoutBrand label={getAppLabel(tenantInfoPromise)} />
        <SiteLayoutNav />
        <SiteLayoutHeaderActions content={getHeaderActionsContent()} />
      </SiteLayoutHeader>
      <SiteLayoutMain>{children}</SiteLayoutMain>
      <SiteLayoutFooter
        copyrightText={getCopyrightText(tenantInfoPromise)}
        footerNote={getFooterNote(tenantInfoPromise)}
      />
    </SiteLayout>
  );
}
