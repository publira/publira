import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";

import { AdminPage } from "../../../../components/admin-page";
import { listSeries } from "../../../../lib/series";
import { SeriesManager } from "./_components/series-manager";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export default async function SeriesPage({
  params,
}: PageProps<"/[tenant_public_id]/series">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const listResult = await listSeries(tenant_public_id);

  return (
    <AdminPage
      description="シリーズ一覧の確認と、編集・エピソード管理への遷移を行います。"
      title="シリーズ"
    >
      <SeriesManager
        initialListErrorMessage={listResult.ok ? undefined : listResult.message}
        initialSeries={listResult.series}
      />
    </AdminPage>
  );
}
