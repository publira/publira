import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformEmailSettings } from "#lib/email-settings";
import type { PlatformSmtpSettings } from "#lib/email-settings";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { EmailSettingsForm } from "./_components/email-settings-form";
import {
  sendPlatformSmtpTestEmailAction,
  updatePlatformEmailSettingsAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.settings.email_title") };
};

const emptySettings: PlatformSmtpSettings = {
  encryption: "starttls",
  fromAddress: "",
  hasPassword: false,
  host: "",
  port: 587,
  replyTo: "",
  revision: "0",
  username: "",
};

const EmailSettingsFormSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-5 w-40" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-40" />
  </ConsoleSection.Root>
);

const EmailSettingsSection = async () => {
  const settingsResult = await getPlatformEmailSettings();

  const initialSettings = settingsResult.ok
    ? settingsResult.settings
    : emptySettings;

  const loadErrorMessage = settingsResult.ok
    ? undefined
    : settingsResult.message;

  return (
    <EmailSettingsForm
      initialSettings={initialSettings}
      loadErrorMessage={loadErrorMessage}
      saveAction={updatePlatformEmailSettingsAction}
      testAction={sendPlatformSmtpTestEmailAction}
    />
  );
};

const PlatformEmailSettingsPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.settings.email_heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.settings.email_page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<EmailSettingsFormSkeleton />}>
        <EmailSettingsSection />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default PlatformEmailSettingsPage;
