import {
  SiteLayoutActions,
  SiteLayout,
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
import { Suspense } from "react";

import { getMe } from "#lib/auth";
import { getTenantSiteInfo } from "#lib/tenant";

const resolveTenantPublicId = async (
  params: Promise<{ tenant_public_id: string }>
): Promise<string> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  return tenant_public_id;
};

const HeaderActionsContent = async ({
  tenantInfoPromise,
}: {
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>;
}) => {
  const { tenantPublicId } = await tenantInfoPromise;
  const me = await getMe(tenantPublicId);
  const hasSession = Boolean(me?.publicId);
  const actions = getAuthActions(hasSession);

  return (
    <SiteLayoutActions
      primaryAction={actions.primaryAction}
      secondaryAction={actions.secondaryAction}
    />
  );
};

const HeaderActionsFallback = () => (
  <div className="flex items-center gap-2" role="status">
    <div
      aria-hidden="true"
      className="bg-muted/70 motion-safe:animate-pulse inline-block h-8 w-20 rounded-md"
    />
    <div
      aria-hidden="true"
      className="bg-muted/70 motion-safe:animate-pulse inline-block h-8 w-24 rounded-md"
    />
  </div>
);

const getHeaderActionsContent = (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
) => (
  <Suspense fallback={<HeaderActionsFallback />}>
    <HeaderActionsContent tenantInfoPromise={tenantInfoPromise} />
  </Suspense>
);

const buildMemberTitleBase = (siteLabel: string): string => siteLabel;

const resolveTenantInfo = async (
  params: Promise<{ tenant_public_id: string }>
) => {
  const tenantPublicId = await resolveTenantPublicId(params);
  const info = await getTenantSiteInfo(tenantPublicId);
  return {
    info,
    tenantPublicId,
  };
};

const getAppLabel = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const { info: tenantInfo } = await tenantInfoPromise;
  return tenantInfo?.siteLabel?.trim() || undefined;
};

const getCopyrightText = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const { info: tenantInfo } = await tenantInfoPromise;
  return tenantInfo?.copyrightText?.trim() || undefined;
};

const getFooterNote = async (
  tenantInfoPromise: ReturnType<typeof resolveTenantInfo>
): Promise<string | undefined> => {
  const { info: tenantInfo } = await tenantInfoPromise;
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
  const base = buildMemberTitleBase(siteLabel);

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
        <SiteLayoutHeaderActions
          content={getHeaderActionsContent(tenantInfoPromise)}
        />
      </SiteLayoutHeader>
      <SiteLayoutMain>{children}</SiteLayoutMain>
      <SiteLayoutFooter
        copyrightText={getCopyrightText(tenantInfoPromise)}
        footerNote={getFooterNote(tenantInfoPromise)}
      />
    </SiteLayout>
  );
}
