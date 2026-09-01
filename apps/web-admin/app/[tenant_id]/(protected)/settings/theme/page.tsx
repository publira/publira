import { getMessage } from "@publira/i18n";
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
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantThemeSettings } from "#lib/theme-settings";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { TenantIconForm } from "../_components/tenant-icon-form";
import { TenantLogoForm } from "../_components/tenant-logo-form";
import { ThemeSettingsForm } from "../_components/theme-settings-form";
import {
  updateTenantIconAction,
  updateTenantLogoAction,
  updateTenantThemeSettingsAction,
} from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.settings.theme_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SettingsThemeFormsSkeleton = () => (
  <div className="grid gap-6">
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded bg-muted/70" />
    </div>
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="grid gap-3">
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
  </div>
);

const SettingsThemeForms = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  const themeResult = await getTenantThemeSettings(tenantId, locale);

  await redirectToLoginIfSessionRejected(themeResult);

  if (!themeResult.ok) {
    return (
      <SectionError
        description={themeResult.message}
        title={getMessage(messages, "admin.settings.theme_error")}
      />
    );
  }

  return (
    <>
      <TenantLogoForm
        action={updateTenantLogoAction}
        initialLogo={themeResult.logo}
      />
      <TenantIconForm
        action={updateTenantIconAction}
        initialIcon={themeResult.icon}
      />
      <ThemeSettingsForm
        action={updateTenantThemeSettingsAction}
        initialTheme={themeResult.theme}
      />
    </>
  );
};

const SettingsThemePage = () => (
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
            <Message message="admin.settings.theme_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="theme" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.theme_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<SettingsThemeFormsSkeleton />}>
            <SettingsThemeForms />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsThemePage;
