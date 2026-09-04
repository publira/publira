import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import "../temporal";
import {
  EmailBody,
  EmailFallbackLink,
  EmailHeading,
  EmailIntro,
  EmailMeta,
} from "../text";
import { httpUrlField, instantField } from "./fields";

export const platformConsolePasswordResetDataSchema = z.object({
  expires_at: instantField("expires_at"),
  reset_url: httpUrlField("reset_url"),
});

export type PlatformConsolePasswordResetData = z.output<
  typeof platformConsolePasswordResetDataSchema
>;

export interface PlatformConsolePasswordResetEmailProps {
  data: PlatformConsolePasswordResetData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const platformConsolePasswordResetSubject = (
  _data: PlatformConsolePasswordResetData,
  messages: Messages
): string =>
  emailMessage(messages, "email.platform_console_password_reset.subject");

export const platformConsolePasswordResetPreview = (
  _data: PlatformConsolePasswordResetData,
  messages: Messages
): string =>
  emailMessage(messages, "email.platform_console_password_reset.preview");

export const PlatformConsolePasswordResetEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: PlatformConsolePasswordResetEmailProps) => (
  <EmailLayout
    locale={locale}
    messages={messages}
    preview={platformConsolePasswordResetPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.platform_console_password_reset.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.platform_console_password_reset.intro")}
    </EmailIntro>
    <EmailBody>
      {emailMessage(messages, "email.platform_console_password_reset.body")}
    </EmailBody>
    <EmailButton href={data.reset_url}>
      {emailMessage(messages, "email.platform_console_password_reset.action")}
    </EmailButton>
    <EmailMeta>
      {emailMessage(messages, "email.platform_console_password_reset.expires", {
        expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
      })}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(messages, "email.platform_console_password_reset.ignore")}
    </EmailMeta>
    <EmailFallbackLink href={data.reset_url}>
      {emailMessage(
        messages,
        "email.platform_console_password_reset.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
