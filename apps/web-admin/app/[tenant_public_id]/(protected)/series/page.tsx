import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { listSeries } from "#lib/series";

import { SeriesManager } from "./_components/series-manager";

export const metadata: Metadata = {
  title: "シリーズ",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

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
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const listResult = await listSeries(tenantPublicId);

  return (
    <SeriesManager
      initialListErrorMessage={listResult.ok ? undefined : listResult.message}
      initialSeries={listResult.series}
    />
  );
};

export default async function SeriesPage({
  params,
}: PageProps<"/[tenant_public_id]/series">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <AdminPage
      description="シリーズ一覧の確認と、編集・エピソード管理への遷移を行います。"
      title="シリーズ"
    >
      <Suspense fallback={<SeriesManagerSkeleton />}>
        <SeriesManagerData tenantPublicId={tenant_public_id} />
      </Suspense>
    </AdminPage>
  );
}
