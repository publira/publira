import { LinkButton } from "@publira/ui-components/button";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "../../../../../components/admin-page";
import { listCreators } from "../../../../../lib/creator";
import { listSeries } from "../../../../../lib/series";
import { SeriesForm } from "../_components/series-form";
import { createSeriesAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "シリーズ新規作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

const NewSeriesFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-24 animate-pulse rounded bg-muted/70" />
      <div className="h-32 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const NewSeriesFormData = async ({
  params,
}: PageProps<"/[tenant_public_id]/series/new">) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const [listResult, creatorsResult] = await Promise.all([
    listSeries(tenant_public_id),
    listCreators(tenant_public_id),
  ]);

  return (
    <SeriesForm
      action={createSeriesAction}
      creators={creatorsResult.creators}
      creatorsErrorMessage={
        creatorsResult.ok ? undefined : creatorsResult.message
      }
      defaultReadingPeriodHours={listResult.defaultReadingPeriodHours}
      mode="create"
      tenantPublicId={tenant_public_id}
    />
  );
};

export default function NewSeriesPage(
  props: PageProps<"/[tenant_public_id]/series/new">
) {
  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/series" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="新しいシリーズを作成します。"
      title="シリーズを新規作成"
    >
      <Suspense fallback={<NewSeriesFormSkeleton />}>
        <NewSeriesFormData {...props} />
      </Suspense>
    </AdminPage>
  );
}
