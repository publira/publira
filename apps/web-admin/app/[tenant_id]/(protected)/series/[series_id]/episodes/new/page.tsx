import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";

import { EpisodeForm } from "../_components/episode-form";
import { createEpisodeAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "エピソード新規作成",
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
        一覧へ戻る
      </LinkButton>
      <LinkButton
        render={<Link href={`/series/${seriesId}`} />}
        variant="outline"
      >
        シリーズへ戻る
      </LinkButton>
    </div>
  );
};

const NewEpisodeFormData = async ({
  params,
}: Pick<NewEpisodePageProps, "params">) => {
  const seriesId = await resolveSeriesId(params);
  return <EpisodeForm action={createEpisodeAction} seriesPublicId={seriesId} />;
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
        <AdminPageTitle>エピソード新規作成</AdminPageTitle>
        <AdminPageDescription>
          シリーズ配下に新しいエピソードを登録します。
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
