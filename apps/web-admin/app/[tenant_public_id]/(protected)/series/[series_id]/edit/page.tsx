import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";

import { AdminPage } from "../../../../../../components/admin-page";
import { getSeries } from "../../../../../../lib/series";
import { SeriesForm } from "../../_components/series-form";
import { updateSeriesAction } from "../../_lib/actions";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "series_id");

export default async function EditSeriesPage({
  params,
}: PageProps<"/[tenant_public_id]/series/[series_id]/edit">) {
  const { series_id, tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  guardPlaceholder(series_id);

  const result = await getSeries({
    publicId: series_id,
    tenantPublicId: tenant_public_id,
  });

  if (!result.ok) {
    return (
      <AdminPage
        description="シリーズ情報を取得できませんでした。"
        title="シリーズを編集"
      >
        <div className="grid gap-4">
          <FormMessage variant="destructive">{result.message}</FormMessage>
          <div>
            <LinkButton href="/series" variant="outline">
              一覧へ戻る
            </LinkButton>
          </div>
        </div>
      </AdminPage>
    );
  }

  return (
    <AdminPage description="シリーズ情報を編集します。" title="シリーズを編集">
      <SeriesForm
        action={updateSeriesAction}
        defaultReadingPeriodHours={result.series.readingPeriodHours}
        initialSeries={result.series}
        mode="update"
        tenantPublicId={tenant_public_id}
      />
    </AdminPage>
  );
}
