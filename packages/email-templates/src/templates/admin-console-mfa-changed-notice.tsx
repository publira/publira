import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import type { JSX } from "react";
import { z } from "zod";

import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { EmailMessageKey, Messages } from "../messages";
import { EmailBody, EmailDetail, EmailHeading, EmailMeta } from "../text";
import {
  adminConsoleMfaChangeField,
  displayNameField,
  instantField,
} from "./fields";

export const adminConsoleMfaChangedNoticeDataSchema: z.ZodObject<
  {
    change: ReturnType<typeof adminConsoleMfaChangeField>;
    changed_at: z.ZodString;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z.object({
  change: adminConsoleMfaChangeField(),
  changed_at: instantField("changed_at"),
  tenant_name: displayNameField("tenant_name"),
});

export type AdminConsoleMfaChangedNoticeData = z.output<
  typeof adminConsoleMfaChangedNoticeDataSchema
>;

export interface AdminConsoleMfaChangedNoticeEmailProps {
  data: AdminConsoleMfaChangedNoticeData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

const changeMessages: Record<
  AdminConsoleMfaChangedNoticeData["change"],
  EmailMessageKey
> = {
  passkey_registered:
    "email.admin_console_mfa_changed_notice.change_passkey_registered",
  passkey_removed:
    "email.admin_console_mfa_changed_notice.change_passkey_removed",
  recovery_codes_regenerated:
    "email.admin_console_mfa_changed_notice.change_recovery_codes_regenerated",
  totp_disabled: "email.admin_console_mfa_changed_notice.change_totp_disabled",
  totp_enabled: "email.admin_console_mfa_changed_notice.change_totp_enabled",
};

export const adminConsoleMfaChangedNoticePreview = (
  _data: AdminConsoleMfaChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.admin_console_mfa_changed_notice.preview");

export const AdminConsoleMfaChangedNoticeEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: AdminConsoleMfaChangedNoticeEmailProps): JSX.Element => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={adminConsoleMfaChangedNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.admin_console_mfa_changed_notice.heading")}
    </EmailHeading>
    <EmailBody>{emailMessage(messages, changeMessages[data.change])}</EmailBody>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.admin_console_mfa_changed_notice.changed_at",
        { changed_at: formatDateTime(data.changed_at, { locale, timeZone }) }
      )}
    </EmailDetail>
    <EmailMeta>
      {emailMessage(messages, "email.admin_console_mfa_changed_notice.warning")}
    </EmailMeta>
  </EmailLayout>
);
