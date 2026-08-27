import { LinkButton } from "@publira/ui-components/button";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { sectionErrorCopy } from "#components/section-error-copy";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listAllCreators } from "#lib/creator";
import { parseEditTab } from "#lib/edit-tab-search-params";
import { listAllLabels } from "#lib/label";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { SeriesEyeCatchForm } from "../_components/series-eye-catch-form";
import { SeriesForm } from "../_components/series-form";
import { SeriesTabNav } from "../_components/series-tab-nav";
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

const editSeriesParamsSchema = z.object({
  series_id: routeParamString(),
});

const resolveActiveTab = async (
  searchParams: EditSeriesPageProps["searchParams"]
): Promise<"basic" | "eye-catch"> => parseEditTab(await searchParams);

const EditSeriesTitle = async ({
  searchParams,
}: Pick<EditSeriesPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch"
    ? "シリーズのアイキャッチを編集"
    : "シリーズを編集";
};

const EditSeriesDescription = async ({
  searchParams,
}: Pick<EditSeriesPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch"
    ? "アイキャッチ画像の差し替え・削除を行います。"
    : "タイトル・概要・公開設定などを編集します。";
};

const EditSeriesTabs = async ({
  params,
  searchParams,
}: EditSeriesPageProps) => {
  const [rawParams, activeTab] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
  ]);
  const parsedParams = parseRouteParams(editSeriesParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { series_id: seriesId } = parsedParams;

  return <SeriesTabNav current={activeTab} seriesId={seriesId} />;
};

const SeriesLoadError = ({ message }: { message: string }) => (
  <SectionError
    actions={
      <LinkButton render={<Link href="/series" />} variant="outline">
        一覧へ戻る
      </LinkButton>
    }
    description={message}
    title="シリーズを表示できませんでした"
  />
);

const EditSeriesFormData = async ({
  params,
  searchParams,
}: EditSeriesPageProps) => {
  const [rawParams, activeTab, tenantId] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
    getTenantId(),
  ]);
  const parsedParams = parseRouteParams(editSeriesParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { series_id: seriesId } = parsedParams;
  if (activeTab === "eye-catch") {
    const result = await getSeries({ publicId: seriesId, tenantId });
    if (!result.ok) {
      if (result.notFound) {
        // Missing, or another tenant's series — never told apart. Renders
        // `(protected)/not-found.tsx` inside the console chrome.
        notFound();
      }
      await redirectToLoginIfSessionRejected(result);
      return <SeriesLoadError message={result.message} />;
    }
    return (
      <SeriesEyeCatchForm
        action={updateSeriesEyeCatchAction}
        initialSeries={result.series}
      />
    );
  }

  const [result, creatorsResult, labelsResult, timeZone] = await Promise.all([
    getSeries({ publicId: seriesId, tenantId }),
    // Walk every cursor page so the Combobox can search past the first 100.
    listAllCreators(tenantId),
    listAllLabels(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    if (result.notFound) {
      notFound();
    }
    await redirectToLoginIfSessionRejected(result);
    return <SeriesLoadError message={result.message} />;
  }

  await redirectToLoginIfSessionRejected(creatorsResult, labelsResult);

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
      timeZone={timeZone}
    />
  );
};

const EditSeriesPage = ({ params, searchParams }: EditSeriesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-64" />}>
            <EditSeriesTitle searchParams={searchParams} />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <EditSeriesDescription searchParams={searchParams} />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/series" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast title="シリーズを作成しました。" />
      <FlashToast keyName="updated" title="シリーズを更新しました。" />
      <div className="grid gap-6">
        <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
          <EditSeriesTabs params={params} searchParams={searchParams} />
        </Suspense>
        <SectionErrorBoundary
          {...sectionErrorCopy("admin.series.detail_error")}
        >
          <Suspense fallback={<EditSeriesFormSkeleton />}>
            <EditSeriesFormData params={params} searchParams={searchParams} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default EditSeriesPage;
