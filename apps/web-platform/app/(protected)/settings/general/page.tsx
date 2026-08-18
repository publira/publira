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
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformSettings } from "#lib/platform-settings";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { updatePlatformDefaultTimezoneAction } from "../_lib/actions";
import { PlatformTimezoneForm } from "./_components/platform-timezone-form";

export const metadata: Metadata = {
  title: "設定 - 一般",
};

const PlatformGeneralSettingsPage = async () => {
  const settingsResult = await getPlatformSettings();

  await redirectToLoginIfSessionRejected(settingsResult);

  return (
    <PlatformPage>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageEyebrow>Platform Settings</PlatformPageEyebrow>
          <PlatformPageTitle>設定</PlatformPageTitle>
          <PlatformPageDescription>
            プラットフォーム全体に適用される既定値を管理します。
          </PlatformPageDescription>
        </PlatformPageHeading>
      </PlatformPageHeader>
      <PlatformPageContent>
        <div className="grid gap-6">
          <SettingsTabNav current="general" />
          <PlatformTimezoneForm
            action={updatePlatformDefaultTimezoneAction}
            initialTimezone={settingsResult.defaultTimezone}
            loadErrorMessage={
              settingsResult.ok ? undefined : settingsResult.message
            }
          />
        </div>
      </PlatformPageContent>
    </PlatformPage>
  );
};

export default PlatformGeneralSettingsPage;
