import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { listCreators } from "#lib/creator";
import { listLabels } from "#lib/label";
import { listSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";

import { SeriesForm } from "../_components/series-form";
import { createSeriesAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "シリーズ新規作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

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

const NewSeriesFormData = async () => {
  const tenantId = await getTenantId();
  const [listResult, creatorsResult, labelsResult] = await Promise.all([
    // Only `defaultReadingPeriodHours` is read here, and that comes from the
    // tenant rather than the page, so the smallest page the API allows is
    // enough.
    listSeries(tenantId, { limit: 1 }),
    // Series author multi-select still needs a single full-ish page until
    // #706 adds a searchable picker; keep the previous 100-row ceiling.
    listCreators(tenantId, { limit: 100 }),
    // Same ceiling for the label picker until a searchable picker lands.
    listLabels(tenantId, { limit: 100 }),
  ]);

  return (
    <SeriesForm
      action={createSeriesAction}
      creators={creatorsResult.creators}
      creatorsErrorMessage={
        creatorsResult.ok ? undefined : creatorsResult.message
      }
      defaultReadingPeriodHours={listResult.defaultReadingPeriodHours}
      labels={labelsResult.labels}
      labelsErrorMessage={labelsResult.ok ? undefined : labelsResult.message}
      mode="create"
    />
  );
};

const NewSeriesPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>シリーズを新規作成</AdminPageTitle>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/series" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<NewSeriesFormSkeleton />}>
        <NewSeriesFormData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default NewSeriesPage;
