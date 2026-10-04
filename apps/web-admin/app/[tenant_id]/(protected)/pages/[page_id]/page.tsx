import { getLocales } from "@publira/i18n";
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
  AdminSections,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { TenantEditorFieldset } from "#components/tenant-role-gate";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPage, listPageTranslations, listPageVersions } from "#lib/page";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PageWorkspace } from "../_components/page-workspace";
import {
  addPageTranslationAction,
  deletePageTranslationAction,
  publishVersionAction,
  rollbackVersionAction,
  savePageAction,
  unpublishPageAction,
} from "../_lib/actions";
import { PageTranslationAddForm } from "./_components/page-translation-add-form";
import { PageTranslationDeleteButton } from "./_components/page-translation-delete-button";
import { PageTranslationTabs } from "./_components/page-translation-tabs";

interface EditPagePageProps {
  params: Promise<{
    page_id: string;
    tenant_id: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const editPageParamsSchema = z.object({
  page_id: routeParamString(),
});

/**
 * The translation to show. Absent, or naming a locale this build does not
 * serve, it is the one the tenant's default locale resolves to.
 */
const editPageSearchParamsSchema = z.object({
  locale: searchParamEnum(getLocales(), { fallback: "" }),
});

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.pages.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "page_id");

const PageWorkspaceSkeleton = () => (
  <AdminSections>
    <Skeleton className="h-[520px]" />
    <Skeleton className="h-72" />
  </AdminSections>
);

const PageLoadError = ({ message }: { message: string }) => (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>
        <Message message="admin.pages.detail_error" />
      </SectionErrorTitle>
      <SectionErrorDescription>{message}</SectionErrorDescription>
    </SectionErrorHeading>
    <SectionErrorActions>
      <LinkButton render={<Link href="/pages" />} variant="outline">
        <Message message="admin.pages.back_to_list" />
      </LinkButton>
    </SectionErrorActions>
  </SectionError>
);

const PageWorkspaceData = async ({
  params,
  searchParams,
}: EditPagePageProps) => {
  const parsedParams = parseRouteParams(editPageParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  const { page_id: pageId } = parsedParams;
  const requestedLocale =
    editPageSearchParamsSchema.parse(await searchParams).locale || undefined;

  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const translationsResult = await listPageTranslations(
    { pageId, tenantId },
    locale
  );

  if (!translationsResult.ok) {
    if (translationsResult.notFound) {
      // Missing, another tenant's page, or an id the URL could never address —
      // never told apart. Renders `(protected)/not-found.tsx` inside the
      // console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(translationsResult);

    return <PageLoadError message={translationsResult.message} />;
  }

  const translatedLocales = translationsResult.translations.map(
    (translation) => translation.locale
  );

  if (requestedLocale && !translatedLocales.includes(requestedLocale)) {
    return (
      <AdminSections>
        <PageTranslationTabs
          pageId={pageId}
          selectedLocale={requestedLocale}
          translatedLocales={translatedLocales}
        />
        <PageTranslationAddForm
          action={addPageTranslationAction}
          pageId={pageId}
          tenantId={tenantId}
          translationLocale={requestedLocale}
        />
      </AdminSections>
    );
  }

  const [pageResult, versionsResult, timeZone] = await Promise.all([
    getPage({ pageId, tenantId, translationLocale: requestedLocale }, locale),
    listPageVersions(
      { pageId, tenantId, translationLocale: requestedLocale },
      locale
    ),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!pageResult.ok) {
    if (pageResult.notFound) {
      notFound();
    }

    await redirectToLoginIfSessionRejected(pageResult);

    return <PageLoadError message={pageResult.message} />;
  }

  if (!versionsResult.ok && versionsResult.versions.length === 0) {
    await redirectToLoginIfSessionRejected(versionsResult);

    return <PageLoadError message={versionsResult.message} />;
  }

  const selectedLocale = pageResult.page.locale;

  return (
    <AdminSections>
      {selectedLocale ? (
        <PageTranslationTabs
          pageId={pageId}
          selectedLocale={selectedLocale}
          translatedLocales={translatedLocales}
        >
          {translatedLocales.length > 1 ? (
            <PageTranslationDeleteButton
              action={deletePageTranslationAction}
              pageId={pageId}
              tenantId={tenantId}
              translationLocale={selectedLocale}
            />
          ) : null}
        </PageTranslationTabs>
      ) : null}
      {/* A key per translation, so the editor's unsaved body never carries over to another language. */}
      <PageWorkspace
        initialPage={pageResult.page}
        initialVersions={versionsResult.versions}
        key={selectedLocale}
        locale={locale}
        publishAction={publishVersionAction}
        rollbackAction={rollbackVersionAction}
        saveAction={savePageAction}
        tenantId={tenantId}
        timeZone={timeZone}
        unpublishAction={unpublishPageAction}
      />
    </AdminSections>
  );
};

const EditPagePage = ({ params, searchParams }: EditPagePageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.pages.edit_title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.pages.edit_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/pages" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.pages.back_to_list" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast message="admin.pages.created" />
      <FlashToast keyName="saved" message="admin.pages.saved" />
      <FlashToast keyName="published" message="admin.pages.published_success" />
      <FlashToast keyName="unpublished" message="admin.pages.unpublished" />
      <FlashToast keyName="rolled_back" message="admin.pages.rolled_back" />
      <FlashToast
        keyName="translation_added"
        message="admin.pages.translations.added"
      />
      <FlashToast
        keyName="translation_deleted"
        message="admin.pages.translations.deleted"
      />

      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.pages.detail_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<PageWorkspaceSkeleton />}>
          <TenantEditorFieldset>
            <PageWorkspaceData params={params} searchParams={searchParams} />
          </TenantEditorFieldset>
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default EditPagePage;
