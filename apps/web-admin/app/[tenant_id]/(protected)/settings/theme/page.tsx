import { EmptyState } from "@publira/ui-components/empty-state";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { getTenantId } from "#lib/tenant-id";
import { getTenantThemeSettings } from "#lib/theme-settings";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { ThemeSettingsForm } from "../_components/theme-settings-form";
import { updateTenantThemeSettingsAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "設定 - テーマ",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SettingsThemePage = async () => {
  const tenantId = await getTenantId();

  const themeResult = await getTenantThemeSettings(tenantId);

  return (
    <AdminPage>
      <AdminPageHeader>
        <AdminPageHeading>
          <AdminPageEyebrow>Console</AdminPageEyebrow>
          <AdminPageTitle>設定</AdminPageTitle>
          <AdminPageDescription>
            テナントごとのテーマカラーを管理します。
          </AdminPageDescription>
        </AdminPageHeading>
      </AdminPageHeader>
      <AdminPageContent>
        <div className="grid gap-6">
          <SettingsTabNav current="theme" />
          {themeResult.ok ? (
            <ThemeSettingsForm
              action={updateTenantThemeSettingsAction}
              initialTheme={themeResult.theme}
            />
          ) : (
            <EmptyState
              description={themeResult.message}
              title="テーマを読み込めませんでした"
            />
          )}
        </div>
      </AdminPageContent>
    </AdminPage>
  );
};

export default SettingsThemePage;
