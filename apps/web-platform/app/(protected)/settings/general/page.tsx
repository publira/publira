import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage, LOCALES } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
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
import {
  updatePlatformDefaultLocaleAction,
  updatePlatformDefaultTimezoneAction,
} from "../_lib/actions";
import { LocaleForm } from "./_components/locale-form";
import type { LocaleFormOption } from "./_components/locale-form";
import { PlatformDefaultLocaleForm } from "./_components/platform-default-locale-form";
import type { PlatformDefaultLocaleFormOption } from "./_components/platform-default-locale-form";
import { PlatformTimezoneForm } from "./_components/platform-timezone-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.settings.general_title") };
};

const tabLabel = (
  message: "platform.settings.email_tab" | "platform.settings.general_tab",
  fallbackClassName: string
) => (
  <Suspense fallback={<SkeletonLine className={fallbackClassName} />}>
    <Message message={message} />
  </Suspense>
);

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

const SettingsFormCardSkeleton = () => (
  <Card>
    <CardHeader>
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-3/4" />
    </CardHeader>
    <CardContent className="grid gap-4 sm:max-w-lg">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-40 justify-self-end" />
    </CardContent>
  </Card>
);

interface DefaultLocaleSectionProps {
  initialDefaultLocale: Locale;
  loadErrorMessage?: string;
}

/**
 * The card labels its options from the message catalog, so it needs the
 * request's locale and stays behind its own `<Suspense>` boundary for the same
 * reason {@link LocaleSection} does. The stored value comes from the settings
 * read the screen already does, so the card adds no round trip of its own.
 */
const DefaultLocaleSection = async ({
  initialDefaultLocale,
  loadErrorMessage,
}: DefaultLocaleSectionProps) => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const options: PlatformDefaultLocaleFormOption[] = LOCALES.map((value) => ({
    label: getMessage(messages, `locale.${value}`),
    locale: value,
  }));

  return (
    <PlatformDefaultLocaleForm
      action={updatePlatformDefaultLocaleAction}
      copy={{
        description: getMessage(
          messages,
          "platform.settings.default_locale_description"
        ),
        fieldDescription: getMessage(
          messages,
          "platform.settings.default_locale_help"
        ),
        label: getMessage(messages, "platform.settings.default_locale_label"),
        placeholder: getMessage(
          messages,
          "platform.settings.default_locale_placeholder"
        ),
        reloadWarning: getMessage(
          messages,
          "platform.settings.default_locale_reload"
        ),
        saveLabel: getMessage(
          messages,
          "platform.settings.default_locale_save"
        ),
        savingLabel: getMessage(messages, "platform.common.saving"),
        title: getMessage(messages, "platform.settings.default_locale_title"),
      }}
      initialDefaultLocale={initialDefaultLocale}
      loadErrorMessage={loadErrorMessage}
      options={options}
    />
  );
};

interface TimezoneSectionProps {
  initialTimezone: string;
  loadErrorMessage?: string;
}

const TimezoneSection = async ({
  initialTimezone,
  loadErrorMessage,
}: TimezoneSectionProps) => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <PlatformTimezoneForm
      action={updatePlatformDefaultTimezoneAction}
      copy={{
        description: getMessage(
          messages,
          "platform.settings.default_timezone_description"
        ),
        emptyMessage: getMessage(
          messages,
          "platform.settings.default_timezone_empty"
        ),
        fieldDescription: getMessage(
          messages,
          "platform.settings.default_timezone_help"
        ),
        label: getMessage(messages, "platform.settings.default_timezone_label"),
        placeholder: getMessage(
          messages,
          "platform.settings.default_timezone_placeholder"
        ),
        reloadWarning: getMessage(
          messages,
          "platform.settings.default_timezone_reload"
        ),
        saveLabel: getMessage(
          messages,
          "platform.settings.default_timezone_save"
        ),
        savingLabel: getMessage(messages, "platform.common.saving"),
        title: getMessage(messages, "platform.settings.default_timezone_title"),
      }}
      initialTimezone={initialTimezone}
      loadErrorMessage={loadErrorMessage}
    />
  );
};

const GeneralSettingsContent = async () => {
  const locale = await getPlatformLocale();
  const settingsResult = await getPlatformSettings(locale);

  await redirectToLoginIfSessionRejected(settingsResult);

  return (
    <div className="grid gap-6">
      <SettingsTabNav
        current="general"
        emailLabel={tabLabel("platform.settings.email_tab", "h-4 w-20")}
        generalLabel={tabLabel("platform.settings.general_tab", "h-4 w-8")}
      />
      <Suspense fallback={<LocaleSectionSkeleton />}>
        <LocaleSection />
      </Suspense>
      <Suspense fallback={<SettingsFormCardSkeleton />}>
        <DefaultLocaleSection
          initialDefaultLocale={settingsResult.defaultLocale}
          loadErrorMessage={
            settingsResult.ok ? undefined : settingsResult.message
          }
        />
      </Suspense>
      <Suspense fallback={<SettingsFormCardSkeleton />}>
        <TimezoneSection
          initialTimezone={settingsResult.defaultTimezone}
          loadErrorMessage={
            settingsResult.ok ? undefined : settingsResult.message
          }
        />
      </Suspense>
    </div>
  );
};

const GeneralSettingsContentSkeleton = () => (
  <div className="grid gap-6">
    <div className="flex flex-wrap gap-2">
      <Skeleton className="h-9 w-16" />
      <Skeleton className="h-9 w-24" />
    </div>
    <LocaleSectionSkeleton />
    <SettingsFormCardSkeleton />
    <SettingsFormCardSkeleton />
  </div>
);

const PlatformGeneralSettingsPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Settings</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-16" />}>
            <Message message="platform.settings.general_heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.settings.general_page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <Suspense fallback={<GeneralSettingsContentSkeleton />}>
        <GeneralSettingsContent />
      </Suspense>
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformGeneralSettingsPage;
