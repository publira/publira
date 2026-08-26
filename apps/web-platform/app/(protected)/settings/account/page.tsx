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

import { requestPlatformEmailChangeAction } from "../_lib/actions";
import { EmailChangeForm } from "./_components/email-change-form";

export const metadata: Metadata = {
  title: "アカウント設定",
};

const PlatformAccountSettingsPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Settings</PlatformPageEyebrow>
        <PlatformPageTitle>アカウント設定</PlatformPageTitle>
        <PlatformPageDescription>
          ログイン中のオペレーターアカウントの情報を管理します。
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <EmailChangeForm action={requestPlatformEmailChangeAction} />
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformAccountSettingsPage;
