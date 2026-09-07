import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import {
  EmailBody,
  EmailDetail,
  EmailFallbackLink,
  EmailHeading,
  EmailMeta,
} from "../text";
import { displayNameField, emailAddressField, httpUrlField } from "./fields";

export const readerPasswordChangedNoticeDataSchema = z.object({
  email: emailAddressField("email"),
  reset_url: httpUrlField("reset_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderPasswordChangedNoticeData = z.output<
  typeof readerPasswordChangedNoticeDataSchema
>;

export interface ReaderPasswordChangedNoticeEmailProps {
  data: ReaderPasswordChangedNoticeData;
  locale: Locale;
  messages: Messages;
}

export const readerPasswordChangedNoticeSubject = (
  data: ReaderPasswordChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_password_changed_notice.subject", {
    tenant_name: data.tenant_name,
  });

export const readerPasswordChangedNoticePreview = (
  _data: ReaderPasswordChangedNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_password_changed_notice.preview");

export const ReaderPasswordChangedNoticeEmail = ({
  data,
  locale,
  messages,
}: ReaderPasswordChangedNoticeEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerPasswordChangedNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_password_changed_notice.heading")}
    </EmailHeading>
    <EmailBody>
      {emailMessage(messages, "email.reader_password_changed_notice.body")}
    </EmailBody>
    <EmailDetail>
      {emailMessage(messages, "email.reader_password_changed_notice.email", {
        email: data.email,
      })}
    </EmailDetail>
    <EmailMeta>
      {emailMessage(messages, "email.reader_password_changed_notice.sessions")}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(messages, "email.reader_password_changed_notice.warning")}
    </EmailMeta>
    <EmailButton href={data.reset_url}>
      {emailMessage(messages, "email.reader_password_changed_notice.action")}
    </EmailButton>
    <EmailFallbackLink href={data.reset_url}>
      {emailMessage(
        messages,
        "email.reader_password_changed_notice.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
