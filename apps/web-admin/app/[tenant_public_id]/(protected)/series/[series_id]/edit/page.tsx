import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminPage } from "../../../../../../components/admin-page";
import { getSeries } from "../../../../../../lib/series";
import { SeriesForm } from "../../_components/series-form";
import { updateSeriesAction } from "../../_lib/actions";

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

const EditSeriesFormData = async ({
  params,
}: PageProps<"/[tenant_public_id]/series/[series_id]/edit">) => {
  const { series_id, tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  guardPlaceholder(series_id);

  const result = await getSeries({
    publicId: series_id,
    tenantPublicId: tenant_public_id,
  });

  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <FormMessage variant="destructive">{result.message}</FormMessage>
        <div>
          <LinkButton href="/series" variant="outline">
            一覧へ戻る
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <SeriesForm
      action={updateSeriesAction}
      defaultReadingPeriodHours={result.series.readingPeriodHours}
      initialSeries={result.series}
      mode="update"
      tenantPublicId={tenant_public_id}
    />
  );
};

export default function EditSeriesPage(
  props: PageProps<"/[tenant_public_id]/series/[series_id]/edit">
) {
  return (
    <AdminPage description="シリーズ情報を編集します。" title="シリーズを編集">
      <Suspense fallback={<EditSeriesFormSkeleton />}>
        <EditSeriesFormData {...props} />
      </Suspense>
    </AdminPage>
  );
}
