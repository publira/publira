import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import {
  TenantEditorRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { isSignedInTenantEditor } from "#lib/auth-session";
import { listAllCreators } from "#lib/creator";
import { listCreatorRoles } from "#lib/creator-roles";
import { listGenres } from "#lib/genre";
import { listAllLabels } from "#lib/label";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listSeries } from "#lib/series";
import { listTagSuggestions } from "#lib/tag";
import { getTenantCommentSettings } from "#lib/tenant-comment-settings";
import { getTenantId } from "#lib/tenant-id";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { SeriesForm } from "../_components/series-form";
import { createSeriesAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isEditor] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantEditor(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isEditor ? t("admin.series.new_title") : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewSeriesFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-24" />
    <Skeleton className="h-32" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const NewSeriesFormData = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [
    listResult,
    creatorsResult,
    creatorRolesResult,
    labelsResult,
    genresResult,
    tagsResult,
    commentSettingsResult,
    purchaseSettingsResult,
    timeZone,
    t,
  ] = await Promise.all([
    // Only `defaultReadingPeriodHours` is read here, and that comes from the
    // tenant rather than the page, so the smallest page the API allows is
    // enough.
    listSeries({ limit: 1 }),
    // Walk every cursor page so the Combobox can search past the first 100.
    listAllCreators(),
    // In the tenant's priority order, which is the order the credit list on
    // the form is shown in.
    listCreatorRoles(),
    listAllLabels(),
    listGenres(),
    listTagSuggestions(tenantId, locale),
    // Only to name the tenant's own mode inside the option that follows it, so
    // a read that failed leaves that option unnamed rather than the form
    // unusable.
    getTenantCommentSettings(tenantId, locale),
    // Likewise for the tenant's default place of sale.
    getTenantPurchaseSettings(tenantId, locale),
    getTenantDisplayTimeZone(tenantId),
    // The placeholders are attributes, which cannot stream in as nodes.
    getMessagesFor(locale),
  ]);

  return (
    <SeriesForm
      action={createSeriesAction}
      creatorRoles={creatorRolesResult.creatorRoles}
      creatorRolesErrorMessage={
        creatorRolesResult.ok ? undefined : creatorRolesResult.message
      }
      creators={creatorsResult.creators}
      creatorsErrorMessage={
        creatorsResult.ok ? undefined : creatorsResult.message
      }
      defaultReadingPeriodHours={listResult.defaultReadingPeriodHours}
      genres={genresResult.genres}
      genresErrorMessage={genresResult.ok ? undefined : genresResult.message}
      labels={labelsResult.labels}
      labelsErrorMessage={labelsResult.ok ? undefined : labelsResult.message}
      mode="create"
      synopsisPlaceholder={t("admin.series.form.synopsis_placeholder")}
      tagSuggestions={tagsResult.tagNames}
      tagSuggestionsErrorMessage={
        tagsResult.ok ? undefined : tagsResult.message
      }
      tenantCommentMode={
        commentSettingsResult.ok ? commentSettingsResult.commentMode : undefined
      }
      tenantPurchaseAvailability={
        purchaseSettingsResult.ok
          ? purchaseSettingsResult.settings.purchaseAvailability
          : undefined
      }
      tenantId={tenantId}
      timeZone={timeZone}
      titlePlaceholder={t("admin.series.form.title_placeholder")}
    />
  );
};

const NewSeriesPage = () => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantEditorRoute>
        <AdminPageHeader>
          <AdminPageHeading>
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
      </TenantEditorRoute>
    </Suspense>
  </AdminPage>
);

export default NewSeriesPage;
