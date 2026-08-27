import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
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
import { setAdminLocaleAction } from "#lib/locale-action";
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantDefaultLocale } from "#lib/tenant-default-locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantTimezone } from "#lib/tenant-timezone";

import { LocaleForm } from "./_components/locale-form";
import type { LocaleFormOption } from "./_components/locale-form";
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

export const metadata: Metadata = {
  title: "設定 - 基本情報",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const LocaleSectionSkeleton = () => (
  <Card>
    <CardHeader>
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-3/4" />
    </CardHeader>
    <CardContent className="flex flex-wrap gap-2">
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-9 w-24" />
    </CardContent>
  </Card>
);

/**
 * Reading the locale cookie and loading its catalog are both request-time work,
 * so they stay behind this section's own `<Suspense>` boundary and the rest of
 * the settings screen still prerenders.
 */
const LocaleSection = async () => {
  const locale = await getLocale(await getTenantId());
  const messages = await loadAdminMessages(locale);

  const options: LocaleFormOption[] = getLocales().map((value) => ({
    label: getLocaleLabel(value),
    locale: value,
  }));

  return (
    <LocaleForm
      action={setAdminLocaleAction}
      currentLocale={locale}
      description={getMessage(messages, "locale.description")}
      label={getMessage(messages, "locale.label")}
      options={options}
    />
  );
};

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

  const [
    settingsResult,
    timezoneResult,
    defaultLocaleResult,
    currentUserResult,
    options,
  ] = await Promise.all([
    getTenantSiteSettings(tenantId),
    getTenantTimezone(tenantId),
    getTenantDefaultLocale(tenantId),
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
          title="設定を表示できませんでした"
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
        initialDefaultLocale={defaultLocaleResult.defaultLocale}
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
        <AdminPageTitle>設定</AdminPageTitle>
        <AdminPageDescription>
          テナントごとの公開表示設定を管理します。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="basic" />
        <Suspense fallback={<LocaleSectionSkeleton />}>
          <LocaleSection />
        </Suspense>
        <SectionErrorBoundary
          description={
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.common.retry_later" />
            </Suspense>
          }
          digestLabel={
            <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
              <Message message="admin.common.error_id" />
            </Suspense>
          }
          retryLabel={
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.common.retry" />
            </Suspense>
          }
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
