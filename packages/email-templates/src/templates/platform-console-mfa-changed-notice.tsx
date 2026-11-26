import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import type { JSX } from "react";
import { z } from "zod";

import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { EmailMessageKey, Messages } from "../messages";
import { EmailBody, EmailDetail, EmailHeading, EmailMeta } from "../text";
import { instantField, platformConsoleMfaChangeField } from "./fields";

export const platformConsoleMfaChangedNoticeDataSchema: z.ZodObject<
  {
    change: ReturnType<typeof platformConsoleMfaChangeField>;
    changed_at: z.ZodString;
  },
  z.core.$strip
> = z.object({
  change: platformConsoleMfaChangeField(),
  changed_at: instantField("changed_at"),
});

export type PlatformConsoleMfaChangedNoticeData = z.output<
  typeof platformConsoleMfaChangedNoticeDataSchema
>;

export interface PlatformConsoleMfaChangedNoticeEmailProps {
  data: PlatformConsoleMfaChangedNoticeData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

const changeMessages: Record<
  PlatformConsoleMfaChangedNoticeData["change"],
  EmailMessageKey
> = {
  recovery_codes_regenerated:
    "email.platform_console_mfa_changed_notice.change_recovery_codes_regenerated",
  totp_disabled:
    "email.platform_console_mfa_changed_notice.change_totp_disabled",
  totp_enabled: "email.platform_console_mfa_changed_notice.change_totp_enabled",
};

export const platformConsoleMfaChangedNoticePreview = (
  _data: PlatformConsoleMfaChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.platform_console_mfa_changed_notice.preview");

export const PlatformConsoleMfaChangedNoticeEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: PlatformConsoleMfaChangedNoticeEmailProps): JSX.Element => (
  <EmailLayout
    brand={emailMessage(messages, "email.layout.brand")}
    locale={locale}
    messages={messages}
    preview={platformConsoleMfaChangedNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(
        messages,
        "email.platform_console_mfa_changed_notice.heading"
      )}
    </EmailHeading>
    <EmailBody>{emailMessage(messages, changeMessages[data.change])}</EmailBody>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.platform_console_mfa_changed_notice.changed_at",
        { changed_at: formatDateTime(data.changed_at, { locale, timeZone }) }
      )}
    </EmailDetail>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.platform_console_mfa_changed_notice.warning"
      )}
    </EmailMeta>
  </EmailLayout>
);
