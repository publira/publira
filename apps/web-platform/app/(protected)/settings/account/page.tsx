import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { EmailChangeForm } from "./_components/email-change-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.settings.account_title") };
};

const PlatformAccountSettingsPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Settings</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.settings.account_heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.settings.account_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <EmailChangeForm />
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformAccountSettingsPage;
