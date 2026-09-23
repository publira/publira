import { getLocaleLabel, getLocales } from "@publira/i18n";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSection,
  AdminSections,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listPublishedPages } from "#lib/page";
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantAgeVerification } from "#lib/tenant-age-verification";
import { getTenantCommentSettings } from "#lib/tenant-comment-settings";
import { getTenantDefaultLocale } from "#lib/tenant-default-locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantLegalPages } from "#lib/tenant-legal-pages";
import { getTenantTimezone } from "#lib/tenant-timezone";

import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { TenantAgeVerificationForm } from "./_components/tenant-age-verification-form";
import { TenantCommentSettingsForm } from "./_components/tenant-comment-settings-form";
import { TenantDefaultLocaleForm } from "./_components/tenant-default-locale-form";
import type { TenantDefaultLocaleFormOption } from "./_components/tenant-default-locale-form";
import { TenantLegalPagesForm } from "./_components/tenant-legal-pages-form";
import { TenantTimezoneForm } from "./_components/tenant-timezone-form";
import {
  updateSiteSettingsAction,
  updateTenantAgeVerificationAction,
  updateTenantCommentSettingsAction,
  updateTenantDefaultLocaleAction,
  updateTenantLegalPagesAction,
  updateTenantTimezoneAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.settings.basic_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SettingsFormsSkeleton = () => (
  <AdminSections>
    <AdminSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-10" />
      <Skeleton className="h-24" />
      <Skeleton className="h-10" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-32" />
      <Skeleton className="h-10" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-32" />
      <Skeleton className="h-10" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-48" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </AdminSection>
  </AdminSections>
);

const tenantDefaultLocaleOptions = (): TenantDefaultLocaleFormOption[] =>
  getLocales().map((value) => ({
    label: getLocaleLabel(value),
    locale: value,
  }));

const SettingsForms = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [
    settingsResult,
    timezoneResult,
    defaultLocaleResult,
    commentSettingsResult,
    ageVerificationResult,
    legalPagesResult,
    publishedPagesResult,
    currentUserResult,
    options,
  ] = await Promise.all([
    getTenantSiteSettings(tenantId, locale),
    getTenantTimezone(tenantId, locale),
    getTenantDefaultLocale(tenantId, locale),
    getTenantCommentSettings(tenantId, locale),
    getTenantAgeVerification(tenantId, locale),
    getTenantLegalPages(tenantId, locale),
    listPublishedPages(tenantId, locale),
    getAdminCurrentUser(tenantId),
    tenantDefaultLocaleOptions(),
  ]);

  await redirectToLoginIfSessionRejected(
    settingsResult,
    timezoneResult,
    defaultLocaleResult,
    commentSettingsResult,
    ageVerificationResult,
    legalPagesResult,
    publishedPagesResult,
    currentUserResult
  );

  const canEdit = isTenantAdminRole(
    currentUserResult.ok ? currentUserResult.user.role : undefined
  );

  return (
    <AdminSections>
      {settingsResult.ok ? (
        <SiteSettingsForm
          action={updateSiteSettingsAction}
          initialSettings={settingsResult.settings}
        />
      ) : (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.settings.section_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {settingsResult.message}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      )}

      <TenantTimezoneForm
        action={updateTenantTimezoneAction}
        canEdit={canEdit}
        initialTimezone={timezoneResult.timezone}
        loadErrorMessage={
          timezoneResult.ok ? undefined : timezoneResult.message
        }
      />

      <TenantDefaultLocaleForm
        action={updateTenantDefaultLocaleAction}
        canEdit={canEdit}
        initialDefaultLocale={
          defaultLocaleResult.ok ? defaultLocaleResult.defaultLocale : undefined
        }
        loadErrorMessage={
          defaultLocaleResult.ok ? undefined : defaultLocaleResult.message
        }
        options={options}
      />

      <TenantCommentSettingsForm
        action={updateTenantCommentSettingsAction}
        canEdit={canEdit}
        initialSettings={
          commentSettingsResult.ok ? commentSettingsResult : undefined
        }
        loadErrorMessage={
          commentSettingsResult.ok ? undefined : commentSettingsResult.message
        }
      />

      <TenantAgeVerificationForm
        action={updateTenantAgeVerificationAction}
        canEdit={canEdit}
        initialAgeVerification={
          ageVerificationResult.ok
            ? ageVerificationResult.ageVerification
            : undefined
        }
        loadErrorMessage={
          ageVerificationResult.ok ? undefined : ageVerificationResult.message
        }
      />

      <TenantLegalPagesForm
        action={updateTenantLegalPagesAction}
        canEdit={canEdit}
        initialPages={legalPagesResult.ok ? legalPagesResult.pages : undefined}
        loadErrorMessage={
          legalPagesResult.ok ? undefined : legalPagesResult.message
        }
        // Listing pages is an admin RPC, so its refusal of anyone else is not a
        // failure worth reporting next to controls they cannot use anyway.
        pagesErrorMessage={
          canEdit && !publishedPagesResult.ok
            ? publishedPagesResult.message
            : undefined
        }
        publishedPages={
          publishedPagesResult.ok
            ? publishedPagesResult.pages.map((page) => ({
                pageId: page.id,
                slug: page.slug,
                title: page.title,
              }))
            : []
        }
      />
    </AdminSections>
  );
};

const SettingsPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.settings.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.basic_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="basic" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.section_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SettingsFormsSkeleton />}>
            <SettingsForms />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsPage;
