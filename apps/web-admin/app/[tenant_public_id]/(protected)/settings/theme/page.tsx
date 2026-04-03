import { EmptyState } from "@publira/ui-components/empty-state";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { AdminPage } from "#components/admin-page";
import { getTenantThemeSettings } from "#lib/theme-settings";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { ThemeSettingsForm } from "../_components/theme-settings-form";
import { updateTenantThemeSettingsAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "設定 - テーマ",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

interface SettingsThemePageProps {
  params: Promise<{ tenant_public_id: string }>;
}

export default async function SettingsThemePage({
  params,
}: SettingsThemePageProps) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const themeResult = await getTenantThemeSettings(tenant_public_id);

  if (!themeResult.ok) {
    return (
      <AdminPage
        description="テナントごとのテーマカラーを管理します。"
        title="設定"
      >
        <div className="grid gap-6">
          <SettingsTabNav current="theme" />
          <EmptyState
            description={themeResult.message}
            title="テーマを読み込めませんでした"
          />
        </div>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      description="テナントごとのテーマカラーを管理します。"
      title="設定"
    >
      <div className="grid gap-6">
        <SettingsTabNav current="theme" />
        <ThemeSettingsForm
          action={updateTenantThemeSettingsAction}
          initialTheme={themeResult.theme}
          tenantPublicId={tenant_public_id}
        />
      </div>
    </AdminPage>
  );
}
