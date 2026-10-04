import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageContext,
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
import {
  isSignedInTenantEditor,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { resolvePurchaseAvailability } from "#lib/purchase-availability";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodeForm } from "../_components/episode-form";
import { createEpisodeAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isEditor] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantEditor(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isEditor
      ? t("admin.series.episodes.new_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

type NewEpisodePageProps =
  PageProps<"/[tenant_id]/series/[series_id]/episodes/new">;

const resolveSeriesId = async (params: NewEpisodePageProps["params"]) => {
  const { series_id: seriesId } = await params;
  guardPlaceholder(seriesId);
  return seriesId;
};

const NewEpisodeContext = async ({
  params,
}: Pick<NewEpisodePageProps, "params">) => {
  const seriesId = await resolveSeriesId(params);
  return `Series ${seriesId}`;
};

const NewEpisodeActions = async ({
  params,
}: Pick<NewEpisodePageProps, "params">) => {
  const seriesId = await resolveSeriesId(params);

  return (
    <div className="flex gap-2">
      <LinkButton
        render={<Link href={`/series/${seriesId}/episodes`} />}
        variant="outline"
      >
        <Message message="admin.series.episodes.back_to_list" />
      </LinkButton>
      <LinkButton
        render={<Link href={`/series/${seriesId}`} />}
        variant="outline"
      >
        <Message message="admin.series.episodes.back_to_series" />
      </LinkButton>
    </div>
  );
};

const NewEpisodeFormData = async ({
  params,
}: Pick<NewEpisodePageProps, "params">) => {
  const [seriesId, tenantId] = await Promise.all([
    resolveSeriesId(params),
    getTenantId(),
  ]);
  const locale = await getLocale(tenantId);
  const [timeZone, seriesResult, purchaseSettingsResult] = await Promise.all([
    getTenantDisplayTimeZone(tenantId),
    getSeries({ publicId: seriesId }),
    getTenantPurchaseSettings(tenantId, locale),
  ]);
  await redirectToLoginIfSessionRejected(purchaseSettingsResult);

  if (!seriesResult.ok) {
    if (seriesResult.notFound) {
      notFound();
    }
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Message message="admin.series.detail_error" />
          </SectionErrorTitle>
          <SectionErrorDescription>
            {seriesResult.message}
          </SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  return (
    <EpisodeForm
      action={createEpisodeAction}
      seriesAvailability={seriesResult.series.availability}
      seriesId={seriesResult.series.id}
      seriesPurchaseAvailability={
        purchaseSettingsResult.ok
          ? resolvePurchaseAvailability(
              purchaseSettingsResult.settings.purchaseAvailability,
              seriesResult.purchaseAvailability
            )
          : undefined
      }
      seriesPublicId={seriesId}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const NewEpisodeFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-24" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const NewEpisodePage = ({ params }: Pick<NewEpisodePageProps, "params">) => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantEditorRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageContext>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <NewEpisodeContext params={params} />
              </Suspense>
            </AdminPageContext>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.series.episodes.new_title" />
              </Suspense>
            </AdminPageTitle>
            <AdminPageDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.series.episodes.new_description" />
              </Suspense>
            </AdminPageDescription>
          </AdminPageHeading>
          <AdminPageActions>
            <Suspense fallback={<SkeletonLine className="h-10 w-56" />}>
              <NewEpisodeActions params={params} />
            </Suspense>
          </AdminPageActions>
        </AdminPageHeader>
        <AdminPageContent>
          <Suspense fallback={<NewEpisodeFormSkeleton />}>
            <NewEpisodeFormData params={params} />
          </Suspense>
        </AdminPageContent>
      </TenantEditorRoute>
    </Suspense>
  </AdminPage>
);

export default NewEpisodePage;
