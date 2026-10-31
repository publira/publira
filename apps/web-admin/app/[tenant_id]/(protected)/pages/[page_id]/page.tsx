import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
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

import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { TenantEditorFieldset } from "#components/tenant-role-gate";
import { TranslationTabs } from "#components/translation-tabs";
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
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";
import { resolveTranslationLocales } from "#lib/translation-locales";

import { PageWorkspace } from "../_components/page-workspace";
import {
  addPageTranslationAction,
  deletePageTranslationAction,
  publishVersionAction,
  rollbackVersionAction,
  savePageAction,
  unpublishPageAction,
} from "../_lib/actions";
import { pageEditPath } from "../page-types";
import { PageTranslationAddForm } from "./_components/page-translation-add-form";
import { PageTranslationDeleteButton } from "./_components/page-translation-delete-button";

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
 * serve or the site does not offer, it is the one {@link resolveTranslationLocales}
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
  <ConsoleSection.Stack>
    <Skeleton className="h-[520px]" />
    <Skeleton className="h-72" />
  </ConsoleSection.Stack>
);

const PageLoadError = ({ message }: { message: string }) => (
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>
        <Message message="admin.pages.detail_error" />
      </SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
    <SectionError.Actions>
      <LinkButton render={<Link href="/pages" />} variant="outline">
        <Message message="admin.pages.back_to_list" />
      </LinkButton>
    </SectionError.Actions>
  </SectionError.Root>
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

  const { locales, shownLocale, visibleLocales } = resolveTranslationLocales({
    requestedLocale,
    tenantLocales,
    translatedLocales,
  });

  const hrefFor = (code: Locale) => pageEditPath(pageId, code);

  if (shownLocale && !visibleLocales.includes(shownLocale)) {
    return (
      <ConsoleSection.Stack>
        <TranslationTabs
          hrefFor={hrefFor}
          locales={locales}
          selectedLocale={shownLocale}
          translatedLocales={visibleLocales}
        />
        <PageTranslationAddForm
          action={addPageTranslationAction}
          pageId={pageId}
          tenantId={tenantId}
          translationLocale={shownLocale}
        />
      </ConsoleSection.Stack>
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
    <ConsoleSection.Stack>
      {selectedLocale ? (
        <TranslationTabs
          hrefFor={hrefFor}
          locales={locales}
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
        </TranslationTabs>
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
    </ConsoleSection.Stack>
  );
};

const EditPagePage = ({ params, searchParams }: EditPagePageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.pages.edit_title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.pages.edit_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
        <LinkButton render={<Link href="/pages" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.pages.back_to_list" />
          </Suspense>
        </LinkButton>
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ConsolePage.Content>
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
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default EditPagePage;
