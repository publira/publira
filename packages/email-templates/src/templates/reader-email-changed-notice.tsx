import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import { EmailBody, EmailDetail, EmailHeading, EmailMeta } from "../text";
import { displayNameField, emailAddressField } from "./fields";

export const readerEmailChangedNoticeDataSchema = z.object({
  new_email: emailAddressField("new_email"),
  previous_email: emailAddressField("previous_email"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderEmailChangedNoticeData = z.output<
  typeof readerEmailChangedNoticeDataSchema
>;

export interface ReaderEmailChangedNoticeEmailProps {
  data: ReaderEmailChangedNoticeData;
  locale: Locale;
  messages: Messages;
}

export const readerEmailChangedNoticeSubject = (
  data: ReaderEmailChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_email_changed_notice.subject", {
    tenant_name: data.tenant_name,
  });

export const readerEmailChangedNoticePreview = (
  _data: ReaderEmailChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_email_changed_notice.preview");

export const ReaderEmailChangedNoticeEmail = ({
  data,
  locale,
  messages,
}: ReaderEmailChangedNoticeEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerEmailChangedNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_email_changed_notice.heading")}
    </EmailHeading>
    <EmailBody>
      {emailMessage(messages, "email.reader_email_changed_notice.body")}
    </EmailBody>
    <EmailDetail>
      {emailMessage(
        messages,
        "email.reader_email_changed_notice.previous_email",
        {
          previous_email: data.previous_email,
        }
      )}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.reader_email_changed_notice.new_email", {
        new_email: data.new_email,
      })}
    </EmailDetail>
    <EmailMeta>
      {emailMessage(messages, "email.reader_email_changed_notice.warning")}
    </EmailMeta>
  </EmailLayout>
);
