import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

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
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.campaign_banners.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.campaign_banners.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <Suspense fallback={null}>
        <TenantEditorOnly>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/campaign-banners/new" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.campaign_banners.new_action" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </TenantEditorOnly>
      </Suspense>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<Table.Skeleton />}>
        <CampaignBannerManagerData />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default CampaignBannerPage;
