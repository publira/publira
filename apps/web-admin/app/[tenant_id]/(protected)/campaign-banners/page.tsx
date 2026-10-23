import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { TenantEditorOnly } from "#components/tenant-role-gate";
import {
  isSignedInTenantEditor,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { listCampaignBanners } from "#lib/campaign-banner";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { CampaignBannerManager } from "./_components/campaign-banner-manager";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.campaign_banners.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CampaignBannerManagerData = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [listResult, canEdit, timeZone] = await Promise.all([
    listCampaignBanners(tenantId, locale),
    isSignedInTenantEditor(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  await redirectToLoginIfSessionRejected(listResult);

  return (
    <CampaignBannerManager
      banners={listResult.banners}
      canEdit={canEdit}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      now={Temporal.Now.instant()}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const CampaignBannerPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.campaign_banners.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.campaign_banners.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <Suspense fallback={null}>
        <TenantEditorOnly>
          <AdminPageActions>
            <LinkButton
              render={<Link href="/campaign-banners/new" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.campaign_banners.new_action" />
              </Suspense>
            </LinkButton>
          </AdminPageActions>
        </TenantEditorOnly>
      </Suspense>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<Table.Skeleton />}>
        <CampaignBannerManagerData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default CampaignBannerPage;
