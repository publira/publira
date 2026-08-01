import { EmptyState } from "@publira/ui-components/empty-state";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { AdminPage } from "#components/admin-page";
import { getTenantSiteSettings } from "#lib/site-settings";

import { SettingsTabNav } from "./_components/settings-tab-nav";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { updateSiteSettingsAction } from "./_lib/actions";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "設定 - 基本情報",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export default async function SettingsPage({
  params,
}: PageProps<"/[tenant_id]">) {
  const tenantId = await getTenantId();

  const settingsResult = await getTenantSiteSettings(tenantId);

  if (!settingsResult.ok) {
    return (
      <AdminPage
        description="テナントごとの公開表示設定を管理します。"
        title="設定"
      >
        <EmptyState
          description={settingsResult.message}
          title="設定を読み込めませんでした"
        />
      </AdminPage>
    );
  }

  return (
    <AdminPage
      description="テナントごとの公開表示設定を管理します。"
      title="設定"
    >
      <div className="grid gap-6">
        <SettingsTabNav current="basic" />

        <SiteSettingsForm
          action={updateSiteSettingsAction}
          initialSettings={settingsResult.settings}
        />
      </div>
    </AdminPage>
  );
}
