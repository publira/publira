import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
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
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
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
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.series.episodes.new_title") };
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
    // Only to name what the options that follow the series follow, so a read
    // that failed leaves them unnamed rather than the form unusable.
    getSeries({ publicId: seriesId, tenantId }, locale),
    getTenantPurchaseSettings(tenantId, locale),
  ]);
  await redirectToLoginIfSessionRejected(seriesResult, purchaseSettingsResult);

  return (
    <EpisodeForm
      action={createEpisodeAction}
      seriesAvailability={
        seriesResult.ok ? seriesResult.series.availability : undefined
      }
      seriesPurchaseAvailability={
        seriesResult.ok && purchaseSettingsResult.ok
          ? resolvePurchaseAvailability(
              purchaseSettingsResult.settings.purchaseAvailability,
              seriesResult.purchaseAvailability
            )
          : undefined
      }
      seriesPublicId={seriesId}
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
  </AdminPage>
);

export default NewEpisodePage;
