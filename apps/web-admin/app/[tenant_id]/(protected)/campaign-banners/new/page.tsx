import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
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
import {
  TenantEditorRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { isSignedInTenantEditor } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { CampaignBannerForm } from "../_components/campaign-banner-form";
import { createCampaignBannerAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isEditor] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantEditor(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isEditor
      ? t("admin.campaign_banners.new_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewCampaignBannerFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const NewCampaignBannerFormData = async () => {
  const tenantId = await getTenantId();
  const timeZone = await getTenantDisplayTimeZone(tenantId);

  return (
    <CampaignBannerForm
      action={createCampaignBannerAction}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const NewCampaignBannerPage = () => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantEditorRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.campaign_banners.new_title" />
              </Suspense>
            </AdminPageTitle>
            <AdminPageDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.campaign_banners.new_description" />
              </Suspense>
            </AdminPageDescription>
          </AdminPageHeading>
          <AdminPageActions>
            <LinkButton
              render={<Link href="/campaign-banners" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.campaign_banners.back_to_list" />
              </Suspense>
            </LinkButton>
          </AdminPageActions>
        </AdminPageHeader>
        <AdminPageContent>
          <Suspense fallback={<NewCampaignBannerFormSkeleton />}>
            <NewCampaignBannerFormData />
          </Suspense>
        </AdminPageContent>
      </TenantEditorRoute>
    </Suspense>
  </AdminPage>
);

export default NewCampaignBannerPage;
