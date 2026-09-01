import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listAllCreators } from "#lib/creator";
import { listAllLabels } from "#lib/label";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { listSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { SeriesForm } from "../_components/series-form";
import { createSeriesAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.series.new_title") };
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
  const locale = await getLocale(tenantId);
  const [listResult, creatorsResult, labelsResult, timeZone] =
    await Promise.all([
      // Only `defaultReadingPeriodHours` is read here, and that comes from the
      // tenant rather than the page, so the smallest page the API allows is
      // enough.
      listSeries(tenantId, locale, { limit: 1 }),
      // Walk every cursor page so the Combobox can search past the first 100.
      listAllCreators(tenantId, locale),
      listAllLabels(tenantId, locale),
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
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.series.new_title" />
          </Suspense>
        </AdminPageTitle>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/series" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.series.back_to_list" />
          </Suspense>
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
