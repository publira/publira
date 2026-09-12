import { getMessage } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
  PlatformSection,
} from "#components/platform-page";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformEmailSettings } from "#lib/email-settings";
import type { PlatformSmtpSettings } from "#lib/email-settings";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import {
  sendPlatformSmtpTestEmailAction,
  updatePlatformEmailSettingsAction,
} from "../_lib/actions";
import { EmailSettingsForm } from "./_components/email-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.settings.email_title") };
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

const tabLabel = (
  message: "platform.settings.email_tab" | "platform.settings.general_tab",
  fallbackClassName: string
) => (
  <Suspense fallback={<SkeletonLine className={fallbackClassName} />}>
    <Message message={message} />
  </Suspense>
);

const EmailSettingsFormSkeleton = () => (
  <PlatformSection>
    <SkeletonLine className="h-5 w-40" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-40" />
  </PlatformSection>
);

const EmailSettingsSection = async () => {
  const locale = await getPlatformLocale();
  const settingsResult = await getPlatformEmailSettings(locale);

  await redirectToLoginIfSessionRejected(settingsResult);

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
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-16" />}>
            <Message message="platform.settings.email_heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.settings.email_page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <div className="grid gap-6">
        <SettingsTabNav
          current="email"
          emailLabel={tabLabel("platform.settings.email_tab", "h-4 w-20")}
          generalLabel={tabLabel("platform.settings.general_tab", "h-4 w-8")}
        />
        <Suspense fallback={<EmailSettingsFormSkeleton />}>
          <EmailSettingsSection />
        </Suspense>
      </div>
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformEmailSettingsPage;
