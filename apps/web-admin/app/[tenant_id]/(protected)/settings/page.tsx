import type { Locale } from "@publira/i18n";
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
import { isTenantAdminRole } from "#lib/admin-auth";
import type { AdminCurrentUser } from "#lib/admin-auth";
import {
  redirectToLoginIfSessionRejected,
  verifyAdminSession,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listPublishedPages } from "#lib/page";
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantAgeVerification } from "#lib/tenant-age-verification";
import { getTenantCommentSettings } from "#lib/tenant-comment-settings";
import { getTenantDefaultLocale } from "#lib/tenant-default-locale";
import { getTenantEmailRejectionSettings } from "#lib/tenant-email-rejection-settings";
import type { TenantEmailRejectionSettingsResult } from "#lib/tenant-email-rejection-settings";
import { getTenantId } from "#lib/tenant-id";
import { getTenantLegalPages } from "#lib/tenant-legal-pages";
import { getTenantTimezone } from "#lib/tenant-timezone";

import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { TenantAgeVerificationForm } from "./_components/tenant-age-verification-form";
import { TenantCommentSettingsForm } from "./_components/tenant-comment-settings-form";
import { TenantDefaultLocaleForm } from "./_components/tenant-default-locale-form";
import { TenantEmailRejectionForm } from "./_components/tenant-email-rejection-form";
import { TenantLegalPagesForm } from "./_components/tenant-legal-pages-form";
import { TenantTimezoneForm } from "./_components/tenant-timezone-form";

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
    <AdminSection>
      <SkeletonLine className="h-5 w-48" />
      <Skeleton className="h-10" />
      <Skeleton className="h-40" />
    </AdminSection>
  </AdminSections>
);

/**
 * The API answers the email rejection setting to a tenant administrator alone,
 * so anyone else is shown the card read-only without asking it.
 */
const readEmailRejectionSettings = async (
  tenantId: string,
  locale: Locale,
  currentUser: Promise<AdminCurrentUser>
): Promise<TenantEmailRejectionSettingsResult | null> => {
  const { role } = await currentUser;
  return isTenantAdminRole(role)
    ? getTenantEmailRejectionSettings(tenantId, locale)
    : null;
};

/** The card's saved state, or what it says about the read that failed. */
const emailRejectionFormState = (
  result: TenantEmailRejectionSettingsResult | null
) =>
  result?.ok
    ? {
        disposableDomainListAvailable: result.disposableDomainListAvailable,
        initialSettings: result.settings,
      }
    : { loadErrorMessage: result?.message };

const SettingsForms = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const currentUserPromise = verifyAdminSession(tenantId);

  const [
    settingsResult,
    timezoneResult,
    defaultLocaleResult,
    commentSettingsResult,
    ageVerificationResult,
    legalPagesResult,
    publishedPagesResult,
    currentUser,
    emailRejectionResult,
  ] = await Promise.all([
    getTenantSiteSettings(tenantId, locale),
    getTenantTimezone(tenantId, locale),
    getTenantDefaultLocale(tenantId, locale),
    getTenantCommentSettings(tenantId, locale),
    getTenantAgeVerification(tenantId, locale),
    getTenantLegalPages(tenantId, locale),
    listPublishedPages(tenantId, locale),
    currentUserPromise,
    readEmailRejectionSettings(tenantId, locale, currentUserPromise),
  ]);

  await redirectToLoginIfSessionRejected(
    settingsResult,
    commentSettingsResult,
    ageVerificationResult,
    legalPagesResult,
    publishedPagesResult,
    ...(emailRejectionResult ? [emailRejectionResult] : [])
  );

  const canEdit = isTenantAdminRole(currentUser.role);

  return (
    <AdminSections>
      {settingsResult.ok ? (
        <SiteSettingsForm
          canEdit={canEdit}
          initialSettings={settingsResult.settings}
          tenantId={tenantId}
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
        canEdit={canEdit}
        initialTimezone={timezoneResult.timezone}
        loadErrorMessage={
          timezoneResult.ok ? undefined : timezoneResult.message
        }
        tenantId={tenantId}
      />

      <TenantDefaultLocaleForm
        canEdit={canEdit}
        initialDefaultLocale={
          defaultLocaleResult.ok ? defaultLocaleResult.defaultLocale : undefined
        }
        loadErrorMessage={
          defaultLocaleResult.ok ? undefined : defaultLocaleResult.message
        }
        tenantId={tenantId}
      />

      <TenantCommentSettingsForm
        canEdit={canEdit}
        initialSettings={
          commentSettingsResult.ok ? commentSettingsResult : undefined
        }
        loadErrorMessage={
          commentSettingsResult.ok ? undefined : commentSettingsResult.message
        }
        tenantId={tenantId}
      />

      <TenantAgeVerificationForm
        canEdit={canEdit}
        initialAgeVerification={
          ageVerificationResult.ok
            ? ageVerificationResult.ageVerification
            : undefined
        }
        loadErrorMessage={
          ageVerificationResult.ok ? undefined : ageVerificationResult.message
        }
        tenantId={tenantId}
      />

      <TenantLegalPagesForm
        canEdit={canEdit}
        initialPages={legalPagesResult.ok ? legalPagesResult.pages : undefined}
        loadErrorMessage={
          legalPagesResult.ok ? undefined : legalPagesResult.message
        }
        // Only a tenant admin can choose a page here, so a list that could not
        // be read is not worth reporting next to controls nobody else can use.
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
        tenantId={tenantId}
      />

      <TenantEmailRejectionForm
        canEdit={canEdit}
        tenantId={tenantId}
        {...emailRejectionFormState(emailRejectionResult)}
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
