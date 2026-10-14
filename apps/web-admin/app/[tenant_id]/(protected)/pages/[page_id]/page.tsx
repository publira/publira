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
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPage, listPageTranslations, listPageVersions } from "#lib/page";
import { getTenantId } from "#lib/tenant-id";
import { getTenantLegalPages } from "#lib/tenant-legal-pages";
import { findTenantLocales } from "#lib/tenant-locales";
import type { TenantLocales } from "#lib/tenant-locales";
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
 * serve or the site does not offer, it is the one {@link translationToShow}
 * picks.
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

/**
 * Whether publishing this page can ask readers to agree to it again: it is the
 * page the tenant names as its terms of service or privacy policy, and the
 * member of staff is a tenant admin, the one role the API lets ask. A failed
 * read of the nomination leaves **Publish** as it is everywhere else, which
 * publishes a correction.
 */
const canAskReadersToAgree = async (
  tenantId: string,
  pageId: string,
  locale: Locale
): Promise<boolean> => {
  if (!(await isSignedInTenantAdmin(tenantId))) {
    return false;
  }
  const legalPages = await getTenantLegalPages(tenantId, locale);
  return (
    legalPages.ok &&
    [legalPages.pages.termsPage, legalPages.pages.privacyPage].some(
      (page) => page?.pageId === pageId
    )
  );
};

/**
 * The languages that have a tab: the ones the site offers, or every one this
 * build serves when they cannot be read, since a tab too many is a smaller
 * fault than a translation nobody can reach.
 */
const tabLocales = (locales: TenantLocales | null): readonly Locale[] =>
  locales?.supportedLocales ?? getLocales();

/**
 * The translation the screen opens on when the URL names none it can show: the
 * default language's, else the first offered language the page has one in,
 * else the form that adds the default one. The API's own choice falls back to
 * any translation, a hidden one included, so it is left to make only when the
 * tenant's languages cannot be read.
 */
const translationToShow = (
  locales: TenantLocales | null,
  visibleLocales: readonly Locale[]
): Locale | undefined => {
  if (!locales) {
    return undefined;
  }
  return visibleLocales.includes(locales.defaultLocale)
    ? locales.defaultLocale
    : (visibleLocales[0] ?? locales.defaultLocale);
};

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
  const [translationsResult, tenantLocales] = await Promise.all([
    listPageTranslations({ pageId, tenantId }, locale),
    findTenantLocales(tenantId),
  ]);

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
  const locales = tabLocales(tenantLocales);
  const offered = new Set(locales);
  const visibleLocales = translatedLocales.filter((code) => offered.has(code));
  const shownLocale =
    requestedLocale && offered.has(requestedLocale)
      ? requestedLocale
      : translationToShow(tenantLocales, visibleLocales);

  if (shownLocale && !visibleLocales.includes(shownLocale)) {
    return (
      <AdminSections>
        <PageTranslationTabs
          locales={locales}
          pageId={pageId}
          selectedLocale={shownLocale}
          translatedLocales={visibleLocales}
        />
        <PageTranslationAddForm
          action={addPageTranslationAction}
          pageId={pageId}
          tenantId={tenantId}
          translationLocale={shownLocale}
        />
      </AdminSections>
    );
  }

  const [pageResult, versionsResult, timeZone, asksReadersToAgree] =
    await Promise.all([
      getPage({ pageId, tenantId, translationLocale: shownLocale }, locale),
      listPageVersions(
        { pageId, tenantId, translationLocale: shownLocale },
        locale
      ),
      getTenantDisplayTimeZone(tenantId),
      canAskReadersToAgree(tenantId, pageId, locale),
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
          locales={locales}
          pageId={pageId}
          selectedLocale={selectedLocale}
          translatedLocales={visibleLocales}
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
        asksReadersToAgree={asksReadersToAgree}
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
