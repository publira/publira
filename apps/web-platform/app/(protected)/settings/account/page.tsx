import type { Metadata } from "next";

import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { requestPlatformEmailChangeAction } from "../_lib/actions";
import { EmailChangeForm } from "./_components/email-change-form";

export const metadata: Metadata = {
  title: "設定 - アカウント",
};

const PlatformAccountSettingsPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Settings</PlatformPageEyebrow>
        <PlatformPageTitle>設定</PlatformPageTitle>
        <PlatformPageDescription>
          アカウント情報を管理します。
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="account" />
        <EmailChangeForm action={requestPlatformEmailChangeAction} />
      </div>
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformAccountSettingsPage;
