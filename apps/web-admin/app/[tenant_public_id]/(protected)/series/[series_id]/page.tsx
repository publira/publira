import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "../../../../../components/admin-page";
import { FlashToast } from "../../../../../components/flash-toast";
import { listCreators } from "../../../../../lib/creator";
import { listLabels } from "../../../../../lib/label";
import { getSeries } from "../../../../../lib/series";
import { SeriesForm } from "../_components/series-form";
import { updateSeriesAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "シリーズ編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "series_id");

const EditSeriesFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="h-24 animate-pulse rounded bg-muted/70" />
      <div className="h-32 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

interface EditSeriesPageProps {
  params: Promise<{
    series_id: string;
    tenant_public_id: string;
  }>;
}

const EditSeriesFormData = async ({
  seriesId,
  tenantPublicId,
}: {
  seriesId: string;
  tenantPublicId: string;
}) => {
  const [result, creatorsResult, labelsResult] = await Promise.all([
    getSeries({
      publicId: seriesId,
      tenantPublicId,
    }),
    listCreators(tenantPublicId),
    listLabels(tenantPublicId),
  ]);

  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <FormMessage variant="destructive">{result.message}</FormMessage>
        <div>
          <LinkButton render={<Link href="/series" />} variant="outline">
            一覧へ戻る
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <SeriesForm
      action={updateSeriesAction}
      creators={creatorsResult.creators}
      creatorsErrorMessage={
        creatorsResult.ok ? undefined : creatorsResult.message
      }
      defaultReadingPeriodHours={result.series.readingPeriodHours}
      initialSeries={result.series}
      labels={labelsResult.labels}
      labelsErrorMessage={labelsResult.ok ? undefined : labelsResult.message}
      mode="update"
      tenantPublicId={tenantPublicId}
    />
  );
};

export default async function EditSeriesPage({ params }: EditSeriesPageProps) {
  const { series_id, tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  guardPlaceholder(series_id);

  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/series" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="シリーズ情報を編集します。"
      title="シリーズを編集"
    >
      <FlashToast title="シリーズを作成しました。" />
      <Suspense fallback={<EditSeriesFormSkeleton />}>
        <EditSeriesFormData
          seriesId={series_id}
          tenantPublicId={tenant_public_id}
        />
      </Suspense>
    </AdminPage>
  );
}
