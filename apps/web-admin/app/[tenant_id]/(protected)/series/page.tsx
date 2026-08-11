import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { listSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";

import { SeriesManager } from "./_components/series-manager";
import {
  buildSeriesPageHref,
  parseSeriesSearchParams,
} from "./_lib/search-params";

const pageSize = 20;

type SeriesPageProps = PageProps<"/[tenant_id]/series">;

export const metadata: Metadata = {
  title: "シリーズ",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SeriesManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const SeriesManagerData = async ({
  searchParams,
}: Pick<SeriesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseSeriesSearchParams(sp);
  const listResult = await listSeries(tenantId, { limit: pageSize, token });

  return (
    <SeriesManager
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      nextHref={
        listResult.nextToken
          ? buildSeriesPageHref({ token: listResult.nextToken })
          : undefined
      }
      pageSize={pageSize}
      previousHref={
        listResult.previousToken
          ? buildSeriesPageHref({ token: listResult.previousToken })
          : undefined
      }
      series={listResult.series}
    />
  );
};

const SeriesPage = ({ searchParams }: SeriesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>シリーズ</AdminPageTitle>
        <AdminPageDescription>
          シリーズ一覧の確認と、編集・エピソード管理への遷移を行います。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<SeriesManagerSkeleton />}>
        <SeriesManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default SeriesPage;
