import { LinkButton } from "@publira/ui-components/button";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
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
import { Message } from "#components/message";
import { getAdminMetadata } from "#lib/admin-metadata";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listAllCreators } from "#lib/creator";
import { listAllLabels } from "#lib/label";
import { listSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { SeriesForm } from "../_components/series-form";
import { createSeriesAction } from "../_lib/actions";

export const generateMetadata = () =>
  getAdminMetadata("admin.series.new_title");

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
  const [listResult, creatorsResult, labelsResult, timeZone] =
    await Promise.all([
      // Only `defaultReadingPeriodHours` is read here, and that comes from the
      // tenant rather than the page, so the smallest page the API allows is
      // enough.
      listSeries(tenantId, { limit: 1 }),
      // Walk every cursor page so the Combobox can search past the first 100.
      listAllCreators(tenantId),
      listAllLabels(tenantId),
      getTenantDisplayTimeZone(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(
    listResult,
    creatorsResult,
    labelsResult
  );

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
      timeZone={timeZone}
    />
  );
};

const NewSeriesPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Message message="admin.series.new_title" />
        </AdminPageTitle>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/series" />} variant="outline">
          <Message message="admin.series.back_to_list" />
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
