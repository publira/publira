import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { getAdminMetadata } from "#lib/admin-metadata";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodeForm } from "../_components/episode-form";
import { createEpisodeAction } from "../_lib/actions";

export const generateMetadata = () =>
  getAdminMetadata("admin.series.episodes.new_title");

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

type NewEpisodePageProps =
  PageProps<"/[tenant_id]/series/[series_id]/episodes/new">;

const resolveSeriesId = async (params: NewEpisodePageProps["params"]) => {
  const { series_id: seriesId } = await params;
  guardPlaceholder(seriesId);
  return seriesId;
};

const NewEpisodeEyebrow = async ({
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
  const timeZone = await getTenantDisplayTimeZone(tenantId);
  return (
    <EpisodeForm
      action={createEpisodeAction}
      seriesPublicId={seriesId}
      timeZone={timeZone}
    />
  );
};

const NewEpisodeFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-24 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NewEpisodePage = ({ params }: Pick<NewEpisodePageProps, "params">) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>
          <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
            <NewEpisodeEyebrow params={params} />
          </Suspense>
        </AdminPageEyebrow>
        <AdminPageTitle>
          <Message message="admin.series.episodes.new_title" />
        </AdminPageTitle>
        <AdminPageDescription>
          <Message message="admin.series.episodes.new_description" />
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
