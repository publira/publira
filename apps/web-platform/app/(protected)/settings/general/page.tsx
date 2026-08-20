import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import { Skeleton } from "@publira/ui-components/skeleton";
import { getMessage, LOCALES } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

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
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { setPlatformLocaleAction } from "#lib/locale-action";
import { getPlatformSettings } from "#lib/platform-settings";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { updatePlatformDefaultTimezoneAction } from "../_lib/actions";
import { LocaleForm } from "./_components/locale-form";
import type { LocaleFormOption } from "./_components/locale-form";
import { PlatformTimezoneForm } from "./_components/platform-timezone-form";

export const metadata: Metadata = {
  title: "設定 - 一般",
};

const LocaleSectionSkeleton = () => (
  <Card>
    <CardHeader>
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-3/4" />
    </CardHeader>
    <CardContent className="flex flex-wrap gap-2">
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-9 w-24" />
    </CardContent>
  </Card>
);

/**
 * Reading the locale cookie and loading its catalog are both request-time work,
 * so they stay behind this section's own `<Suspense>` boundary and the rest of
 * the settings screen still prerenders.
 */
const LocaleSection = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const options: LocaleFormOption[] = LOCALES.map((value) => ({
    label: getMessage(messages, `locale.${value}`),
    locale: value,
  }));

  return (
    <LocaleForm
      action={setPlatformLocaleAction}
      currentLocale={locale}
      description={getMessage(messages, "locale.description")}
      label={getMessage(messages, "locale.label")}
      options={options}
    />
  );
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
          <Suspense fallback={<LocaleSectionSkeleton />}>
            <LocaleSection />
          </Suspense>
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
