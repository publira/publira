import {
  SiteLayout,
  SiteLayoutActions,
  getAuthActions,
} from "@publira/layouts";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { PUBLIC_SESSION_COOKIE_NAME } from "../../lib/auth";
import { getTenantSiteInfo } from "../../lib/tenant";

const HeaderActionsFallback = () => {
  const { primaryAction, secondaryAction } = getAuthActions(false);

  return (
    <SiteLayoutActions
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    />
  );
};

const DynamicHeaderActions = async () => {
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

export default async function TenantLayout({
  children,
  params,
}: LayoutProps<"/[tenant_public_id]">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const info = await getTenantSiteInfo(tenant_public_id);
  const siteLabel = info?.siteLabel ?? "サイト";
  const copyrightText = info?.copyrightText?.trim();

  return (
    <Suspense fallback={null}>
      <SiteLayout
        appLabel={siteLabel}
        copyrightText={copyrightText}
        footerNote={
          getTenantSiteInfo(tenant_public_id).then(
            (info) => info?.siteDescription?.trim(),
          )
        }
        actions={
          <Suspense fallback={<HeaderActionsFallback />}>
            <DynamicHeaderActions />
          </Suspense>
        }
      >
        {children}
      </SiteLayout>
    </Suspense>
  );
}
