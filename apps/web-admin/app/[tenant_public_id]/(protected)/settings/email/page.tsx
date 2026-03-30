import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";

import { AdminPage } from "../../../../../components/admin-page";
import {
  getAdminCurrentUser,
  isTenantAdminRole,
} from "../../../../../lib/admin-auth";
import { getTenantEmailSettings } from "../../../../../lib/email-settings";
import type { TenantSmtpSettings } from "../../../../../lib/email-settings";
import { getTenantForSession } from "../../../../../lib/tenant-detail";
import { SettingsTabNav } from "../_components/settings-tab-nav";
import { TenantEmailSettingsForm } from "../_components/tenant-email-settings-form";
import {
  sendTenantSmtpTestEmailAction,
  updateTenantEmailSettingsAction,
} from "../_lib/actions";

export const metadata: Metadata = {
  title: "設定 - メール情報",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

const emptySettings: TenantSmtpSettings = {
  encryption: "starttls",
  fromAddress: "",
  fromName: "",
  hasPassword: false,
  host: "",
  port: 587,
  replyTo: "",
  smtpOverrideEnabled: false,
  username: "",
};

export default async function SettingsEmailPage({
  params,
}: PageProps<"/[tenant_public_id]/settings/email">) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const [emailSettingsResult, currentUser, tenant] = await Promise.all([
    getTenantEmailSettings(tenant_public_id),
    getAdminCurrentUser(tenant_public_id),
    getTenantForSession(tenant_public_id),
  ]);

  return (
    <AdminPage
      description="テナントごとのメール送信設定を管理します。"
      title="設定"
    >
      <div className="grid gap-6">
        <SettingsTabNav current="email" />
        <TenantEmailSettingsForm
          canEdit={isTenantAdminRole(currentUser?.role)}
          initialSettings={
            emailSettingsResult.ok
              ? emailSettingsResult.settings
              : emptySettings
          }
          loadErrorMessage={
            emailSettingsResult.ok ? undefined : emailSettingsResult.message
          }
          saveAction={updateTenantEmailSettingsAction}
          tenantName={tenant?.name ?? ""}
          tenantPublicId={tenant_public_id}
          testAction={sendTenantSmtpTestEmailAction}
        />
      </div>
    </AdminPage>
  );
}
