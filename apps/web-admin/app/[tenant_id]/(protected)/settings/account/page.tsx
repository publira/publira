import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { AdminPage } from "#components/admin-page";

import { EmailChangeForm } from "../_components/email-change-form";
import { SettingsTabNav } from "../_components/settings-tab-nav";
import { requestEmailChangeAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "設定 - アカウント",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export default function AccountSettingsPage() {
  return (
    <AdminPage description="管理者アカウントの設定を管理します。" title="設定">
      <div className="grid gap-6">
        <SettingsTabNav current="account" />

        <EmailChangeForm action={requestEmailChangeAction} />
      </div>
    </AdminPage>
  );
}
