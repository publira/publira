import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantDefaultLocale } from "#lib/tenant-default-locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantTimezone } from "#lib/tenant-timezone";

import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { TenantDefaultLocaleForm } from "./_components/tenant-default-locale-form";
import type { TenantDefaultLocaleFormOption } from "./_components/tenant-default-locale-form";
import { TenantTimezoneForm } from "./_components/tenant-timezone-form";
import {
  updateSiteSettingsAction,
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
  <div className="grid gap-6">
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="grid gap-3">
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-24 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="h-10 animate-pulse rounded bg-muted/70" />
    </div>
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="h-10 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const tenantDefaultLocaleOptions = (): TenantDefaultLocaleFormOption[] =>
  getLocales().map((value) => ({
    label: getLocaleLabel(value),
    locale: value,
  }));

const SettingsForms = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  const [
    settingsResult,
    timezoneResult,
    defaultLocaleResult,
    currentUserResult,
    options,
  ] = await Promise.all([
    getTenantSiteSettings(tenantId, locale),
    getTenantTimezone(tenantId, locale),
    getTenantDefaultLocale(tenantId, locale),
    getAdminCurrentUser(tenantId),
    tenantDefaultLocaleOptions(),
  ]);

  await redirectToLoginIfSessionRejected(
    settingsResult,
    timezoneResult,
    defaultLocaleResult,
    currentUserResult
  );

  const canEdit = isTenantAdminRole(
    currentUserResult.ok ? currentUserResult.user.role : undefined
  );

  return (
    <>
      {settingsResult.ok ? (
        <SiteSettingsForm
          action={updateSiteSettingsAction}
          initialSettings={settingsResult.settings}
        />
      ) : (
        <SectionError
          description={settingsResult.message}
          title={getMessage(messages, "admin.settings.section_error")}
        />
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
    </>
  );
};

const SettingsPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
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
