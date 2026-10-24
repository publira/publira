import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformSettings } from "#lib/platform-settings";

import { PlatformDefaultCurrencyForm } from "./_components/platform-default-currency-form";
import { PlatformDefaultLocaleForm } from "./_components/platform-default-locale-form";
import { PlatformTimezoneForm } from "./_components/platform-timezone-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.settings.general_title") };
};

const SettingsFormSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-5 w-40" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-40 justify-self-end" />
  </ConsoleSection.Root>
);

interface DefaultLocaleSectionProps {
  /** The saved value, absent when the settings read failed. */
  initialDefaultLocale?: Locale;
  loadErrorMessage?: string;
}

/**
 * The card labels its options from the message catalog, so it needs the
 * request's locale and stays behind its own `<Suspense>` boundary. The stored
 * value comes from the settings read the screen already does, so the card adds
 * no round trip of its own.
 */
const DefaultLocaleSection = ({
  initialDefaultLocale,
  loadErrorMessage,
}: DefaultLocaleSectionProps) => (
  <PlatformDefaultLocaleForm
    initialDefaultLocale={initialDefaultLocale}
    loadErrorMessage={loadErrorMessage}
  />
);

interface TimezoneSectionProps {
  initialTimezone: string;
  loadErrorMessage?: string;
}

const TimezoneSection = ({
  initialTimezone,
  loadErrorMessage,
}: TimezoneSectionProps) => (
  <PlatformTimezoneForm
    initialTimezone={initialTimezone}
    loadErrorMessage={loadErrorMessage}
  />
);

const GeneralSettingsContent = async () => {
  const settingsResult = await getPlatformSettings();

  return (
    <div className="grid gap-6">
      <Suspense fallback={<SettingsFormSkeleton />}>
        <DefaultLocaleSection
          initialDefaultLocale={
            settingsResult.ok ? settingsResult.defaultLocale : undefined
          }
          loadErrorMessage={
            settingsResult.ok ? undefined : settingsResult.message
          }
        />
      </Suspense>
      <Suspense fallback={<SettingsFormSkeleton />}>
        <TimezoneSection
          initialTimezone={settingsResult.defaultTimezone}
          loadErrorMessage={
            settingsResult.ok ? undefined : settingsResult.message
          }
        />
      </Suspense>
      <Suspense fallback={<SettingsFormSkeleton />}>
        <PlatformDefaultCurrencyForm
          initialDefaultCurrency={
            settingsResult.ok ? settingsResult.defaultCurrency : undefined
          }
          loadErrorMessage={
            settingsResult.ok ? undefined : settingsResult.message
          }
          locked={settingsResult.ok && settingsResult.defaultCurrencyLocked}
        />
      </Suspense>
    </div>
  );
};

const GeneralSettingsContentSkeleton = () => (
  <div className="grid gap-6">
    <SettingsFormSkeleton />
    <SettingsFormSkeleton />
    <SettingsFormSkeleton />
  </div>
);

const PlatformGeneralSettingsPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.settings.general_heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.settings.general_page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<GeneralSettingsContentSkeleton />}>
        <GeneralSettingsContent />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default PlatformGeneralSettingsPage;
