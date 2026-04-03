import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { AdminPage } from "#components/admin-page";

import { EmailChangeForm } from "../_components/email-change-form";
import { SettingsTabNav } from "../_components/settings-tab-nav";
import { requestEmailChangeAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "設定 - アカウント",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export default async function AccountSettingsPage({
  params,
}: PageProps<"/[tenant_public_id]">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  return (
    <AdminPage description="管理者アカウントの設定を管理します。" title="設定">
      <div className="grid gap-6">
        <SettingsTabNav current="account" />

        <EmailChangeForm
          action={requestEmailChangeAction}
          tenantPublicId={tenant_public_id}
        />
      </div>
    </AdminPage>
  );
}
