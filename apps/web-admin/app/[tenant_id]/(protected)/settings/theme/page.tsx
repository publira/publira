import { SectionError } from "@publira/ui-components/section-error";
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
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
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

export const metadata: Metadata = {
  title: "設定 - テーマ",
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

  const themeResult = await getTenantThemeSettings(tenantId);

  await redirectToLoginIfSessionRejected(themeResult);

  if (!themeResult.ok) {
    return (
      <SectionError
        description={themeResult.message}
        title="テーマを表示できませんでした"
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
        <AdminPageTitle>設定</AdminPageTitle>
        <AdminPageDescription>
          テナントごとのテーマカラー、ロゴ、アイコンを管理します。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="theme" />
        <SectionErrorBoundary title="テーマを表示できませんでした">
          <Suspense fallback={<SettingsThemeFormsSkeleton />}>
            <SettingsThemeForms />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default SettingsThemePage;
