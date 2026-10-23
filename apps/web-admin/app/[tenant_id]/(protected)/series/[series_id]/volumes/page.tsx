import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
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
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  isSignedInTenantEditor,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantCurrency } from "#lib/public-api";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { listVolumes } from "#lib/volume";

import { SeriesTabNav } from "../../_components/series-tab-nav";
import { VolumeCreateForm } from "./_components/volume-create-form";
import { VolumeList } from "./_components/volume-list";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.series.volumes.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

interface SeriesVolumesPageProps {
  params: Promise<{
    series_id: string;
    tenant_id: string;
  }>;
}

const seriesVolumesParamsSchema = z.object({
  series_id: routeParamString(),
});

const resolveSeriesPublicId = async (
  params: SeriesVolumesPageProps["params"]
): Promise<string> => {
  const parsedParams = parseRouteParams(
    seriesVolumesParamsSchema,
    await params
  );
  if (!parsedParams) {
    notFound();
  }
  return parsedParams.series_id;
};

const SeriesVolumesTabs = async ({ params }: SeriesVolumesPageProps) => (
  <SeriesTabNav
    current="volumes"
    seriesId={await resolveSeriesPublicId(params)}
  />
);

const SeriesVolumesData = async ({ params }: SeriesVolumesPageProps) => {
  const [seriesPublicId, tenantId] = await Promise.all([
    resolveSeriesPublicId(params),
    getTenantId(),
  ]);
  const [locale, seriesResult] = await Promise.all([
    getLocale(tenantId),
    getSeries({ publicId: seriesPublicId }),
  ]);
  if (!seriesResult.ok) {
    if (seriesResult.notFound) {
      // Missing, or another tenant's series — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Message message="admin.series.detail_error" />
          </SectionError.Title>
          <SectionError.Description>
            {seriesResult.message}
          </SectionError.Description>
        </SectionError.Heading>
        <SectionError.Actions>
          <LinkButton render={<Link href="/series" />} variant="outline">
            <Message message="admin.series.back_to_list" />
          </LinkButton>
        </SectionError.Actions>
      </SectionError.Root>
    );
  }

  const seriesId = seriesResult.series.id;
  const [listResult, canEdit, currency, t] = await Promise.all([
    listVolumes({ seriesId, tenantId }, locale),
    isSignedInTenantEditor(tenantId),
    getTenantCurrency(tenantId),
    getMessagesFor(locale),
  ]);
  await redirectToLoginIfSessionRejected(listResult);

  let createForm = null;
  if (canEdit) {
    // A price entered in no currency is a number nobody can read.
    createForm = currency ? (
      <VolumeCreateForm
        currency={currency}
        // The tenant's currency is in the key, so a form opened in the old one
        // starts over instead of sending the amount typed in it.
        key={currency}
        seriesId={seriesId}
        seriesPublicId={seriesPublicId}
        tenantId={tenantId}
      />
    ) : (
      <FormMessage variant="destructive">
        {t("admin.series.episodes.currency_unavailable")}
      </FormMessage>
    );
  }

  return (
    <div className="grid gap-6">
      {createForm}
      <VolumeList
        canEdit={canEdit}
        currency={currency}
        listErrorMessage={listResult.ok ? undefined : listResult.message}
        locale={locale}
        seriesId={seriesId}
        seriesPublicId={seriesPublicId}
        tenantId={tenantId}
        volumes={listResult.volumes}
      />
    </div>
  );
};

const SeriesVolumesPage = ({ params }: SeriesVolumesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.series.volumes.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.volumes.page_description" />
          </Suspense>
        </AdminPageDescription>
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
      <div className="grid gap-6">
        <Suspense fallback={<SkeletonLine className="h-9 w-72" />}>
          <SeriesVolumesTabs params={params} />
        </Suspense>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.series.volumes.list_error" />
            </Suspense>
          }
        >
          <Suspense
            fallback={
              <div className="grid gap-6">
                <Skeleton className="h-48" />
                <Table.Skeleton />
              </div>
            }
          >
            <SeriesVolumesData params={params} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SeriesVolumesPage;
