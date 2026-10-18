import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { EyeCatchAspectImages } from "#components/eye-catch/aspect-images";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { TenantEditorFieldset } from "#components/tenant-role-gate";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getCampaignBanner } from "#lib/campaign-banner";
import { parseEditTab } from "#lib/edit-tab-search-params";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { CampaignBannerForm } from "../_components/campaign-banner-form";
import { CampaignBannerImageForm } from "../_components/campaign-banner-image-form";
import { CampaignBannerTabNav } from "../_components/campaign-banner-tab-nav";
import {
  updateCampaignBannerAction,
  uploadCampaignBannerAspectImageAction,
} from "../_lib/actions";

interface EditCampaignBannerPageProps {
  params: Promise<{
    campaign_banner_id: string;
    tenant_id: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

const editCampaignBannerParamsSchema = z.object({
  campaign_banner_id: routeParamString(),
});

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.campaign_banners.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "campaign_banner_id");

const EditCampaignBannerFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const resolveActiveTab = async (
  searchParams: EditCampaignBannerPageProps["searchParams"]
): Promise<"basic" | "eye-catch"> => parseEditTab(await searchParams);

const EditCampaignBannerTitle = async ({
  searchParams,
}: Pick<EditCampaignBannerPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.campaign_banners.image_title" />
  ) : (
    <Message message="admin.campaign_banners.edit_title" />
  );
};

const EditCampaignBannerDescription = async ({
  searchParams,
}: Pick<EditCampaignBannerPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.campaign_banners.image_description" />
  ) : (
    <Message message="admin.campaign_banners.edit_description" />
  );
};

const EditCampaignBannerTabNav = async ({
  params,
  searchParams,
}: EditCampaignBannerPageProps) => {
  const [rawParams, activeTab] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
  ]);
  const parsedParams = parseRouteParams(
    editCampaignBannerParamsSchema,
    rawParams
  );
  if (!parsedParams) {
    notFound();
  }

  return (
    <CampaignBannerTabNav
      campaignBannerId={parsedParams.campaign_banner_id}
      current={activeTab}
    />
  );
};

const EditCampaignBannerFormData = async ({
  params,
  searchParams,
}: EditCampaignBannerPageProps) => {
  const [rawParams, activeTab, tenantId] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
    getTenantId(),
  ]);
  const parsedParams = parseRouteParams(
    editCampaignBannerParamsSchema,
    rawParams
  );
  if (!parsedParams) {
    notFound();
  }

  const locale = await getLocale(tenantId);
  const [result, timeZone] = await Promise.all([
    getCampaignBanner(
      { publicId: parsedParams.campaign_banner_id, tenantId },
      locale
    ),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's banner — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }
    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Message message="admin.campaign_banners.detail_error" />
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
        <SectionErrorActions>
          <LinkButton
            render={<Link href="/campaign-banners" />}
            variant="outline"
          >
            <Message message="admin.campaign_banners.back_to_list" />
          </LinkButton>
        </SectionErrorActions>
      </SectionError>
    );
  }

  if (activeTab === "eye-catch") {
    return (
      // Both cards hold the picked file and the chosen ratio in local state,
      // so the tab is keyed by the banner it belongs to: moving to another
      // banner remounts it rather than leaving that state behind.
      <div className="grid gap-6" key={result.banner.publicId}>
        <CampaignBannerImageForm banner={result.banner} tenantId={tenantId} />
        <EyeCatchAspectImages
          entity="campaign_banner"
          id={result.banner.id}
          tenantId={tenantId}
          uploadAction={uploadCampaignBannerAspectImageAction}
          variants={result.banner.imageVariants}
        />
      </div>
    );
  }

  return (
    <CampaignBannerForm
      action={updateCampaignBannerAction}
      initialBanner={result.banner}
      key={result.banner.publicId}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const EditCampaignBannerPage = ({
  params,
  searchParams,
}: EditCampaignBannerPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-64" />}>
            <EditCampaignBannerTitle searchParams={searchParams} />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <EditCampaignBannerDescription searchParams={searchParams} />
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
      <FlashToast message="admin.campaign_banners.created" />
      <div className="grid gap-6">
        <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
          <EditCampaignBannerTabNav
            params={params}
            searchParams={searchParams}
          />
        </Suspense>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.campaign_banners.detail_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<EditCampaignBannerFormSkeleton />}>
            <TenantEditorFieldset>
              <EditCampaignBannerFormData
                params={params}
                searchParams={searchParams}
              />
            </TenantEditorFieldset>
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default EditCampaignBannerPage;
