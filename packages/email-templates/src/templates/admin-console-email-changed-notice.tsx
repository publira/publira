import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import { EmailBody, EmailDetail, EmailHeading, EmailMeta } from "../text";
import { displayNameField, emailAddressField } from "./fields";

export const adminConsoleEmailChangedNoticeDataSchema = z.object({
  new_email: emailAddressField("new_email"),
  previous_email: emailAddressField("previous_email"),
  tenant_name: displayNameField("tenant_name"),
});

export type AdminConsoleEmailChangedNoticeData = z.output<
  typeof adminConsoleEmailChangedNoticeDataSchema
>;

export interface AdminConsoleEmailChangedNoticeEmailProps {
  data: AdminConsoleEmailChangedNoticeData;
  locale: Locale;
  messages: Messages;
}

export const adminConsoleEmailChangedNoticeSubject = (
  data: AdminConsoleEmailChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.admin_console_email_changed_notice.subject", {
    tenant_name: data.tenant_name,
  });

export const adminConsoleEmailChangedNoticePreview = (
  _data: AdminConsoleEmailChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.admin_console_email_changed_notice.preview");

export const AdminConsoleEmailChangedNoticeEmail = ({
  data,
  locale,
  messages,
}: AdminConsoleEmailChangedNoticeEmailProps) => (
  <EmailLayout
    locale={locale}
    messages={messages}
    preview={adminConsoleEmailChangedNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(
        messages,
        "email.admin_console_email_changed_notice.heading"
      )}
    </EmailHeading>
    <EmailBody>
      {emailMessage(messages, "email.admin_console_email_changed_notice.body")}
    </EmailBody>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.admin_console_email_changed_notice.previous_email",
        {
          previous_email: data.previous_email,
        }
      )}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.admin_console_email_changed_notice.new_email",
        {
          new_email: data.new_email,
        }
      )}
    </EmailDetail>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.admin_console_email_changed_notice.warning"
      )}
    </EmailMeta>
  </EmailLayout>
);
