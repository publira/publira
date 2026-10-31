import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  TenantEditorRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantEditor,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantCurrency } from "#lib/public-api";
import { resolvePurchaseAvailability } from "#lib/purchase-availability";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodeForm } from "../_components/episode-form";
import { createEpisodeAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isEditor] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantEditor(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isEditor
      ? t("admin.series.episodes.new_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

type NewEpisodePageProps =
  PageProps<"/[tenant_id]/series/[series_id]/episodes/new">;

const resolveSeriesId = async (params: NewEpisodePageProps["params"]) => {
  const { series_id: seriesId } = await params;
  guardPlaceholder(seriesId);

  return seriesId;
};

const NewEpisodeContext = async ({
  params,
}: Pick<NewEpisodePageProps, "params">) => {
  const seriesId = await resolveSeriesId(params);

  return `Series ${seriesId}`;
};

const NewEpisodeActions = async ({
  params,
}: Pick<NewEpisodePageProps, "params">) => {
  const seriesId = await resolveSeriesId(params);

  return (
    <div className="flex gap-2">
      <LinkButton
        render={<Link href={`/series/${seriesId}/episodes`} />}
        variant="outline"
      >
        <Message message="admin.series.episodes.back_to_list" />
      </LinkButton>
      <LinkButton
        render={<Link href={`/series/${seriesId}`} />}
        variant="outline"
      >
        <Message message="admin.series.episodes.back_to_series" />
      </LinkButton>
    </div>
  );
};

const NewEpisodeFormData = async ({
  params,
}: Pick<NewEpisodePageProps, "params">) => {
  const [seriesId, tenantId] = await Promise.all([
    resolveSeriesId(params),
    getTenantId(),
  ]);

  const locale = await getLocale(tenantId);

  const [timeZone, seriesResult, purchaseSettingsResult, currency] =
    await Promise.all([
      getTenantDisplayTimeZone(tenantId),
      getSeries({ publicId: seriesId }),
      getTenantPurchaseSettings(tenantId, locale),
      getTenantCurrency(tenantId),
    ]);

  await redirectToLoginIfSessionRejected(purchaseSettingsResult);

  if (!seriesResult.ok) {
    if (seriesResult.notFound) {
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
      </SectionError.Root>
    );
  }

  // A price entered in no currency is a number nobody can read, so the form
  // waits for the tenant's.
  if (!currency) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Message message="admin.series.episodes.currency_unavailable" />
          </SectionError.Title>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return (
    <EpisodeForm
      action={createEpisodeAction}
      currency={currency}
      seriesAvailability={seriesResult.series.availability}
      seriesId={seriesResult.series.id}
      seriesPurchaseAvailability={
        purchaseSettingsResult.ok
          ? resolvePurchaseAvailability(
              purchaseSettingsResult.settings.purchaseAvailability,
              seriesResult.purchaseAvailability
            )
          : undefined
      }
      seriesPublicId={seriesId}
      seriesReadingPeriodHours={seriesResult.series.readingPeriodHours}
      seriesRentalPeriodHours={seriesResult.series.rentalPeriodHours}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const NewEpisodeFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-24" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const NewEpisodePage = ({ params }: Pick<NewEpisodePageProps, "params">) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantEditorRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Context>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <NewEpisodeContext params={params} />
              </Suspense>
            </ConsolePage.Context>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.series.episodes.new_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.series.episodes.new_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <Suspense fallback={<SkeletonLine className="h-10 w-56" />}>
              <NewEpisodeActions params={params} />
            </Suspense>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <Suspense fallback={<NewEpisodeFormSkeleton />}>
            <NewEpisodeFormData params={params} />
          </Suspense>
        </ConsolePage.Content>
      </TenantEditorRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default NewEpisodePage;
