import { SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformMessageKey } from "#components/message";
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

import { requestPlatformEmailChangeAction } from "../_lib/actions";
import { EmailChangeForm } from "./_components/email-change-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.settings.account_title") };
};

const copyText = (message: PlatformMessageKey, fallbackClassName: string) => (
  <Suspense fallback={<SkeletonLine className={fallbackClassName} />}>
    <Message message={message} />
  </Suspense>
);

const PlatformAccountSettingsPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Settings</PlatformPageEyebrow>
        <PlatformPageTitle>
          {copyText("platform.settings.account_heading", "h-8 w-40")}
        </PlatformPageTitle>
        <PlatformPageDescription>
          {copyText("platform.settings.account_description", "h-4 w-80")}
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <EmailChangeForm
        action={requestPlatformEmailChangeAction}
        copy={{
          currentEmailLabel: copyText(
            "platform.settings.email_change_current",
            "h-4 w-40"
          ),
          description: copyText(
            "platform.settings.email_change_description",
            "h-4 w-3/4"
          ),
          newEmailLabel: copyText(
            "platform.settings.email_change_new",
            "h-4 w-40"
          ),
          passwordHelp: copyText(
            "platform.settings.email_change_password_help",
            "h-4 w-64"
          ),
          passwordLabel: copyText(
            "platform.settings.email_change_password",
            "h-4 w-32"
          ),
          pendingLabel: copyText(
            "platform.settings.email_change_pending",
            "h-4 w-16"
          ),
          submitLabel: copyText(
            "platform.settings.email_change_submit",
            "h-4 w-32"
          ),
          title: copyText("platform.settings.email_change_title", "h-6 w-40"),
        }}
      />
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformAccountSettingsPage;
