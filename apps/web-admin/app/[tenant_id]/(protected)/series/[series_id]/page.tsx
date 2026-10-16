import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { searchParamEnum } from "@publira/utils/search-params";
import type { SearchParamValue } from "@publira/utils/search-params";
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
import { EyeCatchAspectImages } from "#components/eye-catch/aspect-images";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { TenantEditorFieldset } from "#components/tenant-role-gate";
import { TranslationTabs } from "#components/translation-tabs";
import { isSignedInTenantEditor } from "#lib/auth-session";
import type { SeriesTranslationItem } from "#lib/catalog-translation";
import { listAllCreators } from "#lib/creator";
import { listCreatorRoles } from "#lib/creator-roles";
import { parseEditTab } from "#lib/edit-tab-search-params";
import { listGenres } from "#lib/genre";
import { listAllLabels } from "#lib/label";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getSeries } from "#lib/series";
import { getSeriesWaitFreeSettings } from "#lib/series-wait-free";
import { listTagSuggestions } from "#lib/tag";
import { getTenantCommentSettings } from "#lib/tenant-comment-settings";
import { getTenantId } from "#lib/tenant-id";
import { findTenantLocales } from "#lib/tenant-locales";
import type { TenantLocales } from "#lib/tenant-locales";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";
import {
  resolveTranslationToEdit,
  translationEditPath,
} from "#lib/translation-locales";

import { SeriesEyeCatchForm } from "../_components/series-eye-catch-form";
import { SeriesForm } from "../_components/series-form";
import { SeriesTabNav } from "../_components/series-tab-nav";
import {
  deleteSeriesTranslationAction,
  updateSeriesAction,
  updateSeriesEyeCatchAction,
  updateSeriesWaitFreeSettingsAction,
  uploadSeriesEyeCatchAspectImageAction,
} from "../_lib/actions";
import { SeriesTranslationDeleteButton } from "./_components/series-translation-delete-button";
import { SeriesWaitFreeForm } from "./_components/series-wait-free-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.series.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

const EditSeriesFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-24" />
    <Skeleton className="h-32" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

interface EditSeriesPageProps {
  params: Promise<{
    series_id: string;
    tenant_id: string;
  }>;
  searchParams: Promise<{
    locale?: SearchParamValue;
    tab?: string;
  }>;
}

const editSeriesParamsSchema = z.object({
  series_id: routeParamString(),
});

/**
 * The language whose title and synopsis the basic tab edits. Absent, or naming
 * a locale this build does not serve or the site does not offer, it is the one
 * {@link resolveTranslationToEdit} picks.
 */
const editSeriesSearchParamsSchema = z.object({
  locale: searchParamEnum(getLocales(), { fallback: "" }),
});

const requestedTranslationLocale = (
  searchParams: Awaited<EditSeriesPageProps["searchParams"]>
): Locale | undefined =>
  editSeriesSearchParamsSchema.parse(searchParams).locale || undefined;

/**
 * The translation the cover image tab sends the title back in: the one
 * `Series.title` was read from, which is the default language's, else the
 * oldest.
 */
const titleTranslation = (
  translations: readonly SeriesTranslationItem[],
  tenantLocales: TenantLocales | null
): SeriesTranslationItem | undefined =>
  translations.find(
    (translation) => translation.locale === tenantLocales?.defaultLocale
  ) ?? translations[0];

const resolveActiveTab = async (
  searchParams: EditSeriesPageProps["searchParams"]
): Promise<"basic" | "eye-catch"> => parseEditTab(await searchParams);

const EditSeriesTitle = async ({
  searchParams,
}: Pick<EditSeriesPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.series.eye_catch_title" />
  ) : (
    <Message message="admin.series.edit_title" />
  );
};

const EditSeriesDescription = async ({
  searchParams,
}: Pick<EditSeriesPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.series.eye_catch_description" />
  ) : (
    <Message message="admin.series.edit_description" />
  );
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
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>
        <Message message="admin.series.detail_error" />
      </SectionErrorTitle>
      <SectionErrorDescription>{message}</SectionErrorDescription>
    </SectionErrorHeading>
    <SectionErrorActions>
      <LinkButton render={<Link href="/series" />} variant="outline">
        <Message message="admin.series.back_to_list" />
      </LinkButton>
    </SectionErrorActions>
  </SectionError>
);

const SeriesWaitFreeSection = async ({
  seriesId,
  seriesPublicId,
  tenantId,
}: {
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
}) => {
  const result = await getSeriesWaitFreeSettings({ seriesId });
  // A failed read has no rule to open the form on, and a save from defaults
  // would write them over the one the series holds.
  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.series.wait_free.load_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { settings } = result;
  return (
    <SeriesWaitFreeForm
      action={updateSeriesWaitFreeSettingsAction}
      initialSettings={settings}
      key={`${seriesPublicId}:${String(settings.enabled)}:${settings.rechargeHours}:${settings.accessHours}:${settings.excludedLatestCount}`}
      seriesId={seriesId}
      seriesPublicId={seriesPublicId}
      tenantId={tenantId}
    />
  );
};

const SeriesEyeCatchTabData = async ({
  seriesId,
  tenantId,
}: {
  seriesId: string;
  tenantId: string;
}) => {
  const [result, tenantLocales] = await Promise.all([
    getSeries({ publicId: seriesId }),
    findTenantLocales(tenantId),
  ]);
  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's series — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }
    return <SeriesLoadError message={result.message} />;
  }
  const translation = titleTranslation(result.translations, tenantLocales);
  return (
    // Both cards hold the picked file and the chosen ratio in local state,
    // so the tab is keyed by the series it belongs to: moving to another
    // series remounts it rather than leaving that state behind.
    <div className="grid gap-6" key={result.series.publicId}>
      <SeriesEyeCatchForm
        action={updateSeriesEyeCatchAction}
        series={{
          ...result.series,
          title: translation?.title ?? result.series.title,
        }}
        tenantId={tenantId}
        translationLocale={translation?.locale}
      />
      <EyeCatchAspectImages
        id={result.series.id}
        entity="series"
        tenantId={tenantId}
        uploadAction={uploadSeriesEyeCatchAspectImageAction}
        variants={result.series.eyeCatchImageVariants}
      />
    </div>
  );
};

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
    return <SeriesEyeCatchTabData seriesId={seriesId} tenantId={tenantId} />;
  }
  const locale = await getLocale(tenantId);

  const [
    result,
    creatorsResult,
    creatorRolesResult,
    labelsResult,
    genresResult,
    tagsResult,
    commentSettingsResult,
    purchaseSettingsResult,
    timeZone,
    t,
    canCreateLabel,
    tenantLocales,
    rawSearchParams,
  ] = await Promise.all([
    getSeries({ publicId: seriesId }),
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
    isSignedInTenantEditor(tenantId),
    findTenantLocales(tenantId),
    searchParams,
  ]);

  if (!result.ok) {
    if (result.notFound) {
      notFound();
    }
    return <SeriesLoadError message={result.message} />;
  }

  const { translations } = result;
  const { locales, shownLocale, translation, visibleLocales } =
    resolveTranslationToEdit({
      requestedLocale: requestedTranslationLocale(rawSearchParams),
      tenantLocales,
      translations,
    });

  return (
    <div className="grid gap-6">
      {shownLocale ? (
        <TranslationTabs
          hrefFor={(code) => translationEditPath(`/series/${seriesId}`, code)}
          locales={locales}
          selectedLocale={shownLocale}
          translatedLocales={visibleLocales}
        >
          {translation && translations.length > 1 ? (
            <SeriesTranslationDeleteButton
              action={deleteSeriesTranslationAction}
              seriesPublicId={result.series.publicId}
              tenantId={tenantId}
              translationLocale={translation.locale}
            />
          ) : null}
        </TranslationTabs>
      ) : null}
      <SeriesForm
        action={updateSeriesAction}
        canCreateLabel={canCreateLabel}
        creatorRoles={creatorRolesResult.creatorRoles}
        creatorRolesErrorMessage={
          creatorRolesResult.ok ? undefined : creatorRolesResult.message
        }
        creators={creatorsResult.creators}
        creatorsErrorMessage={
          creatorsResult.ok ? undefined : creatorsResult.message
        }
        genres={genresResult.genres}
        genresErrorMessage={genresResult.ok ? undefined : genresResult.message}
        initialCommentMode={result.commentMode}
        initialPurchaseAvailability={result.purchaseAvailability}
        initialReadingLayout={result.readingLayout}
        initialSeries={{
          ...result.series,
          synopsis: translation?.synopsis ?? "",
          title: translation?.title ?? "",
        }}
        // A key per translation, so a title typed on one language's tab never
        // carries over to another.
        key={`${result.series.publicId}:${shownLocale ?? ""}`}
        labels={labelsResult.labels}
        labelsErrorMessage={labelsResult.ok ? undefined : labelsResult.message}
        mode="update"
        synopsisPlaceholder={t("admin.series.form.synopsis_placeholder")}
        tagSuggestions={tagsResult.tagNames}
        tagSuggestionsErrorMessage={
          tagsResult.ok ? undefined : tagsResult.message
        }
        tenantCommentMode={
          commentSettingsResult.ok
            ? commentSettingsResult.commentMode
            : undefined
        }
        tenantPurchaseAvailability={
          purchaseSettingsResult.ok
            ? purchaseSettingsResult.settings.purchaseAvailability
            : undefined
        }
        tenantId={tenantId}
        timeZone={timeZone}
        titlePlaceholder={t("admin.series.form.title_placeholder")}
        translated={translation !== undefined}
        translationLocale={shownLocale}
      />
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.series.wait_free.load_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<Skeleton className="h-64" />}>
          <SeriesWaitFreeSection
            seriesId={result.series.id}
            seriesPublicId={result.series.publicId}
            tenantId={tenantId}
          />
        </Suspense>
      </SectionErrorBoundary>
    </div>
  );
};

const EditSeriesPage = ({ params, searchParams }: EditSeriesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
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
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.series.back_to_list" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast message="admin.series.created" />
      <FlashToast keyName="updated" message="admin.series.updated" />
      <FlashToast
        keyName="translation_deleted"
        message="admin.series.translations.deleted"
      />
      <FlashToast
        keyName="wait_free_updated"
        message="admin.series.wait_free.updated"
      />
      <div className="grid gap-6">
        <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
          <EditSeriesTabs params={params} searchParams={searchParams} />
        </Suspense>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.series.detail_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<EditSeriesFormSkeleton />}>
            <TenantEditorFieldset>
              <EditSeriesFormData params={params} searchParams={searchParams} />
            </TenantEditorFieldset>
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default EditSeriesPage;
