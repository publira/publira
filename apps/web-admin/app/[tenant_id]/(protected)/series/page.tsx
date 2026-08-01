import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { listSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";

import { SeriesManager } from "./_components/series-manager";

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

const SeriesManagerData = async () => {
  const tenantId = await getTenantId();
  const listResult = await listSeries(tenantId);

  return (
    <SeriesManager
      initialListErrorMessage={listResult.ok ? undefined : listResult.message}
      initialSeries={listResult.series}
    />
  );
};

export default function SeriesPage() {
  return (
    <AdminPage
      description="シリーズ一覧の確認と、編集・エピソード管理への遷移を行います。"
      title="シリーズ"
    >
      <Suspense fallback={<SeriesManagerSkeleton />}>
        <SeriesManagerData />
      </Suspense>
    </AdminPage>
  );
}
