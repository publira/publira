import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";
import { z } from "zod";

import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import "../temporal";
import {
  EmailDetail,
  EmailHeading,
  EmailIntro,
  EmailMeta,
  EmailQuote,
} from "../text";
import {
  displayNameField,
  emailAddressField,
  instantField,
  optionalSingleLineField,
  quotedTextField,
} from "./fields";

export const staffContactMessageNoticeDataSchema = z.object({
  body: quotedTextField("body", 4000),
  received_at: instantField("received_at"),
  reply_to_email: emailAddressField("reply_to_email"),
  /** Empty for a guest, and for a sender whose account has been deleted since. */
  sender_name: optionalSingleLineField("sender_name", 255),
  /** Empty for a message the reader gave no subject. */
  subject: optionalSingleLineField("subject", 200),
  tenant_name: displayNameField("tenant_name"),
});

export type StaffContactMessageNoticeData = z.output<
  typeof staffContactMessageNoticeDataSchema
>;

export interface StaffContactMessageNoticeEmailProps {
  data: StaffContactMessageNoticeData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const staffContactMessageNoticePreview = (
  data: StaffContactMessageNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.staff_contact_message_notice.preview", {
    tenant_name: data.tenant_name,
  });

/**
 * The mail that tells a tenant's staff a reader wrote in. It offers no link:
 * what staff do next is answer the reply-to address from their own mail client,
 * and the message itself travels with the mail so they can read it without
 * opening anything.
 */
export const StaffContactMessageNoticeEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: StaffContactMessageNoticeEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={staffContactMessageNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.staff_contact_message_notice.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.staff_contact_message_notice.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    <EmailDetail>
      {emailMessage(messages, "email.staff_contact_message_notice.reply_to", {
        reply_to_email: data.reply_to_email,
      })}
    </EmailDetail>
    {data.sender_name === "" ? null : (
      <EmailDetail>
        {emailMessage(messages, "email.staff_contact_message_notice.sender", {
          sender_name: data.sender_name,
        })}
      </EmailDetail>
    )}
    {data.subject === "" ? null : (
      <EmailDetail>
        {emailMessage(
          messages,
          "email.staff_contact_message_notice.subject_line",
          { subject: data.subject }
        )}
      </EmailDetail>
    )}
    <EmailDetail>
      {emailMessage(messages, "email.staff_contact_message_notice.received", {
        received_at: formatDateTime(data.received_at, { locale, timeZone }),
      })}
    </EmailDetail>
    <EmailHeading>
      {emailMessage(
        messages,
        "email.staff_contact_message_notice.body_heading"
      )}
    </EmailHeading>
    <EmailQuote>{data.body}</EmailQuote>
    <EmailMeta>
      {emailMessage(messages, "email.staff_contact_message_notice.footnote")}
    </EmailMeta>
  </EmailLayout>
);
