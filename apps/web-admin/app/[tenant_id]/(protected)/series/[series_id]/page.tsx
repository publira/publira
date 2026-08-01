import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminPage } from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { listCreators } from "#lib/creator";
import { listLabels } from "#lib/label";
import { getSeries } from "#lib/series";

import { SeriesEyeCatchForm } from "../_components/series-eye-catch-form";
import { SeriesForm } from "../_components/series-form";
import { SeriesTabNav } from "../_components/series-tab-nav";
import { getTenantId } from "#lib/tenant-id";
import {
  updateSeriesAction,
  updateSeriesEyeCatchAction,
} from "../_lib/actions";

export const metadata: Metadata = {
  title: "シリーズ編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

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
    tenant_id: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

const EditSeriesFormData = async ({ activeTab, seriesId }: { activeTab: "basic" | "eye-catch"; seriesId: string }) => {
  const tenantId = await getTenantId();
  if (activeTab === "eye-catch") {
    const result = await getSeries({ publicId: seriesId, tenantId });
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
      <SeriesEyeCatchForm
        action={updateSeriesEyeCatchAction}
        initialSeries={result.series}
      />
    );
  }

  const [result, creatorsResult, labelsResult] = await Promise.all([
    getSeries({ publicId: seriesId, tenantId }),
    listCreators(tenantId),
    listLabels(tenantId),
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
    />
  );
};

export default async function EditSeriesPage({
  params,
  searchParams,
}: EditSeriesPageProps) {
  const { series_id } = await params;
  const { tab } = await searchParams;
  
  guardPlaceholder(series_id);

  const activeTab = tab === "eye-catch" ? "eye-catch" : "basic";
  const pageTitle =
    activeTab === "eye-catch"
      ? "シリーズのアイキャッチを編集"
      : "シリーズを編集";
  const pageDescription =
    activeTab === "eye-catch"
      ? "アイキャッチ画像の差し替え・削除を行います。"
      : "タイトル・概要・公開設定などを編集します。";

  return (
    <AdminPage
      actions={
        <LinkButton render={<Link href="/series" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description={pageDescription}
      title={pageTitle}
    >
      <FlashToast title="シリーズを作成しました。" />
      <FlashToast keyName="updated" title="シリーズを更新しました。" />
      <div className="grid gap-6">
        <SeriesTabNav current={activeTab} seriesId={series_id} />
        <Suspense fallback={<EditSeriesFormSkeleton />}>
          <EditSeriesFormData
            activeTab={activeTab}
            seriesId={series_id}
          />
        </Suspense>
      </div>
    </AdminPage>
  );
}
