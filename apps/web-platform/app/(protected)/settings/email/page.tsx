import type { Metadata } from "next";

import { PlatformPage } from "../../../../components/platform-page";
import { getPlatformEmailSettings } from "../../../../lib/email-settings";
import type { PlatformSmtpSettings } from "../../../../lib/email-settings";
import { SettingsTabNav } from "../_components/settings-tab-nav";
import {
  sendPlatformSmtpTestEmailAction,
  updatePlatformEmailSettingsAction,
} from "../_lib/actions";
import { EmailSettingsForm } from "./_components/email-settings-form";

export const metadata: Metadata = {
  title: "設定 - メール設定",
};

const emptySettings: PlatformSmtpSettings = {
  encryption: "starttls",
  fromAddress: "",
  hasPassword: false,
  host: "",
  port: 587,
  replyTo: "",
  username: "",
};

export default async function PlatformEmailSettingsPage() {
  const settingsResult = await getPlatformEmailSettings();

  const initialSettings = settingsResult.ok
    ? settingsResult.settings
    : emptySettings;

  return (
    <PlatformPage
      description="プラットフォーム既定の SMTP を管理します。"
      eyebrow="Platform Settings"
      title="設定"
    >
      <div className="grid gap-6">
        <SettingsTabNav current="email" />
        <EmailSettingsForm
          initialSettings={initialSettings}
          loadErrorMessage={
            settingsResult.ok ? undefined : settingsResult.message
          }
          saveAction={updatePlatformEmailSettingsAction}
          testAction={sendPlatformSmtpTestEmailAction}
        />
      </div>
    </PlatformPage>
  );
}
