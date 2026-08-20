import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import { Skeleton } from "@publira/ui-components/skeleton";
import { getMessage, LOCALES } from "@publira/utils/i18n";
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
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { setAdminLocaleAction } from "#lib/locale-action";
import { getTenantSiteSettings } from "#lib/site-settings";
import { getTenantId } from "#lib/tenant-id";
import { getTenantTimezone } from "#lib/tenant-timezone";

import { LocaleForm } from "./_components/locale-form";
import type { LocaleFormOption } from "./_components/locale-form";
import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { TenantTimezoneForm } from "./_components/tenant-timezone-form";
import {
  updateSiteSettingsAction,
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
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  const options: LocaleFormOption[] = LOCALES.map((value) => ({
    label: getMessage(messages, `locale.${value}`),
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
  </div>
);

const SettingsForms = async () => {
  const tenantId = await getTenantId();

  const [settingsResult, timezoneResult, currentUserResult] = await Promise.all(
    [
      getTenantSiteSettings(tenantId),
      getTenantTimezone(tenantId),
      getAdminCurrentUser(tenantId),
    ]
  );

  await redirectToLoginIfSessionRejected(
    settingsResult,
    timezoneResult,
    currentUserResult
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
        canEdit={isTenantAdminRole(
          currentUserResult.ok ? currentUserResult.user.role : undefined
        )}
        initialTimezone={timezoneResult.timezone}
        loadErrorMessage={
          timezoneResult.ok ? undefined : timezoneResult.message
        }
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
        <SectionErrorBoundary title="設定を表示できませんでした">
          <Suspense fallback={<SettingsFormsSkeleton />}>
            <SettingsForms />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsPage;
