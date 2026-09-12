import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
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
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantCommentSettings } from "#lib/tenant-comment-settings";
import { getTenantDefaultLocale } from "#lib/tenant-default-locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantTimezone } from "#lib/tenant-timezone";

import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { TenantCommentSettingsForm } from "./_components/tenant-comment-settings-form";
import { TenantDefaultLocaleForm } from "./_components/tenant-default-locale-form";
import type { TenantDefaultLocaleFormOption } from "./_components/tenant-default-locale-form";
import { TenantTimezoneForm } from "./_components/tenant-timezone-form";
import {
  updateSiteSettingsAction,
  updateTenantCommentSettingsAction,
  updateTenantDefaultLocaleAction,
  updateTenantTimezoneAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.settings.basic_title") };
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
    currentUserResult,
    options,
  ] = await Promise.all([
    getTenantSiteSettings(tenantId, locale),
    getTenantTimezone(tenantId, locale),
    getTenantDefaultLocale(tenantId, locale),
    getTenantCommentSettings(tenantId, locale),
    getAdminCurrentUser(tenantId),
    tenantDefaultLocaleOptions(),
  ]);

  await redirectToLoginIfSessionRejected(
    settingsResult,
    timezoneResult,
    defaultLocaleResult,
    commentSettingsResult,
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
