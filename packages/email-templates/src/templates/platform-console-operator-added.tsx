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

export const platformConsoleOperatorAddedDataSchema = z.object({
  expires_at: instantField("expires_at"),
  set_password_url: httpUrlField("set_password_url"),
});

export type PlatformConsoleOperatorAddedData = z.output<
  typeof platformConsoleOperatorAddedDataSchema
>;

export interface PlatformConsoleOperatorAddedEmailProps {
  data: PlatformConsoleOperatorAddedData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const platformConsoleOperatorAddedPreview = (
  _data: PlatformConsoleOperatorAddedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.platform_console_operator_added.preview");

export const PlatformConsoleOperatorAddedEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: PlatformConsoleOperatorAddedEmailProps) => (
  <EmailLayout
    brand={emailMessage(messages, "email.layout.brand")}
    locale={locale}
    messages={messages}
    preview={platformConsoleOperatorAddedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.platform_console_operator_added.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.platform_console_operator_added.intro")}
    </EmailIntro>
    <EmailBody>
      {emailMessage(messages, "email.platform_console_operator_added.body")}
    </EmailBody>
    <EmailButton href={data.set_password_url}>
      {emailMessage(messages, "email.platform_console_operator_added.action")}
    </EmailButton>
    <EmailMeta>
      {emailMessage(messages, "email.platform_console_operator_added.expires", {
        expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
      })}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.platform_console_operator_added.expired_help"
      )}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(messages, "email.platform_console_operator_added.ignore")}
    </EmailMeta>
    <EmailFallbackLink href={data.set_password_url}>
      {emailMessage(
        messages,
        "email.platform_console_operator_added.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
