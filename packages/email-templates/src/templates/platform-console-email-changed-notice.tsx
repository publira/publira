import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import { EmailBody, EmailDetail, EmailHeading, EmailMeta } from "../text";
import { emailAddressField } from "./fields";

export const platformConsoleEmailChangedNoticeDataSchema = z.object({
  new_email: emailAddressField("new_email"),
  previous_email: emailAddressField("previous_email"),
});

export type PlatformConsoleEmailChangedNoticeData = z.output<
  typeof platformConsoleEmailChangedNoticeDataSchema
>;

export interface PlatformConsoleEmailChangedNoticeEmailProps {
  data: PlatformConsoleEmailChangedNoticeData;
  locale: Locale;
  messages: Messages;
}

export const platformConsoleEmailChangedNoticeSubject = (
  _data: PlatformConsoleEmailChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.platform_console_email_changed_notice.subject");

export const platformConsoleEmailChangedNoticePreview = (
  _data: PlatformConsoleEmailChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.platform_console_email_changed_notice.preview");

export const PlatformConsoleEmailChangedNoticeEmail = ({
  data,
  locale,
  messages,
}: PlatformConsoleEmailChangedNoticeEmailProps) => (
  <EmailLayout
    locale={locale}
    messages={messages}
    preview={platformConsoleEmailChangedNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(
        messages,
        "email.platform_console_email_changed_notice.heading"
      )}
    </EmailHeading>
    <EmailBody>
      {emailMessage(
        messages,
        "email.platform_console_email_changed_notice.body"
      )}
    </EmailBody>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.platform_console_email_changed_notice.previous_email",
        {
          previous_email: data.previous_email,
        }
      )}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.platform_console_email_changed_notice.new_email",
        {
          new_email: data.new_email,
        }
      )}
    </EmailDetail>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.platform_console_email_changed_notice.warning"
      )}
    </EmailMeta>
  </EmailLayout>
);
