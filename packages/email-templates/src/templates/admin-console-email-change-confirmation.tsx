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
  EmailDetail,
  EmailFallbackLink,
  EmailHeading,
  EmailIntro,
  EmailMeta,
} from "../text";
import {
  displayNameField,
  emailAddressField,
  httpUrlField,
  instantField,
  recipientKindField,
} from "./fields";

export const adminConsoleEmailChangeConfirmationDataSchema = z.object({
  confirm_url: httpUrlField("confirm_url"),
  current_email: emailAddressField("current_email"),
  expires_at: instantField("expires_at"),
  new_email: emailAddressField("new_email"),
  recipient_kind: recipientKindField(),
  tenant_name: displayNameField("tenant_name"),
});

export type AdminConsoleEmailChangeConfirmationData = z.output<
  typeof adminConsoleEmailChangeConfirmationDataSchema
>;

export interface AdminConsoleEmailChangeConfirmationEmailProps {
  data: AdminConsoleEmailChangeConfirmationData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const adminConsoleEmailChangeConfirmationSubject = (
  data: AdminConsoleEmailChangeConfirmationData,
  messages: Messages
): string =>
  emailMessage(
    messages,
    "email.admin_console_email_change_confirmation.subject",
    {
      tenant_name: data.tenant_name,
    }
  );

export const adminConsoleEmailChangeConfirmationPreview = (
  _data: AdminConsoleEmailChangeConfirmationData,
  messages: Messages
): string =>
  emailMessage(
    messages,
    "email.admin_console_email_change_confirmation.preview"
  );

export const AdminConsoleEmailChangeConfirmationEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: AdminConsoleEmailChangeConfirmationEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={adminConsoleEmailChangeConfirmationPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.heading"
      )}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.intro"
      )}
    </EmailIntro>
    <EmailBody>
      {emailMessage(
        messages,
        data.recipient_kind === "current_email"
          ? "email.admin_console_email_change_confirmation.body_current_email"
          : "email.admin_console_email_change_confirmation.body_new_email"
      )}
    </EmailBody>
    <EmailButton href={data.confirm_url}>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.action"
      )}
    </EmailButton>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.expires",
        {
          expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
        }
      )}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.ignore"
      )}
    </EmailMeta>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.current_email",
        {
          current_email: data.current_email,
        }
      )}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.new_email",
        {
          new_email: data.new_email,
        }
      )}
    </EmailDetail>
    <EmailFallbackLink href={data.confirm_url}>
      {emailMessage(
        messages,
        "email.admin_console_email_change_confirmation.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
