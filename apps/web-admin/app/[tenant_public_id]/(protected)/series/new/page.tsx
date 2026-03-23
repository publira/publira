import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";

import { AdminPage } from "../../../../../components/admin-page";
import { listSeries } from "../../../../../lib/series";
import { SeriesForm } from "../_components/series-form";
import { createSeriesAction } from "../_lib/actions";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export default async function NewSeriesPage({
  params,
}: PageProps<"/[tenant_public_id]/series/new">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const listResult = await listSeries(tenant_public_id);

  return (
    <AdminPage
      description="新しいシリーズを作成します。"
      title="シリーズを新規作成"
    >
      <SeriesForm
        action={createSeriesAction}
        defaultReadingPeriodHours={listResult.defaultReadingPeriodHours}
        mode="create"
        tenantPublicId={tenant_public_id}
      />
    </AdminPage>
  );
}
