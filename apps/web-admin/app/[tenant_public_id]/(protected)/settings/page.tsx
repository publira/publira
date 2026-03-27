import { EmptyState } from "@publira/ui-components/empty-state";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { AdminPage } from "../../../../components/admin-page";
import { getTenantSiteSettings } from "../../../../lib/site-settings";
import { SiteSettingsForm } from "./_components/site-settings-form";
import { updateSiteSettingsAction } from "./_lib/actions";

export const metadata: Metadata = {
  title: "設定",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export default async function SettingsPage({
  params,
}: PageProps<"/[tenant_public_id]">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const settingsResult = await getTenantSiteSettings(tenant_public_id);

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
      <SiteSettingsForm
        action={updateSiteSettingsAction}
        initialSettings={settingsResult.settings}
        tenantPublicId={tenant_public_id}
      />
    </AdminPage>
  );
}
