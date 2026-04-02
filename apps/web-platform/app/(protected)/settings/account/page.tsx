import type { Metadata } from "next";

import { PlatformPage } from "../../../../components/platform-page";
import { SettingsTabNav } from "../_components/settings-tab-nav";
import { requestPlatformEmailChangeAction } from "../_lib/actions";
import { EmailChangeForm } from "./_components/email-change-form";

export const metadata: Metadata = {
  title: "設定 - アカウント",
};

export default function PlatformAccountSettingsPage() {
  return (
    <PlatformPage
      description="アカウント情報を管理します。"
      eyebrow="Platform Settings"
      title="設定"
    >
      <div className="grid gap-6">
        <SettingsTabNav current="account" />
        <EmailChangeForm action={requestPlatformEmailChangeAction} />
      </div>
    </PlatformPage>
  );
}
