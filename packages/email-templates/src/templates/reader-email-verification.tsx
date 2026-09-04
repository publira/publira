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
import { displayNameField, httpUrlField, instantField } from "./fields";

export const readerEmailVerificationDataSchema = z.object({
  expires_at: instantField("expires_at"),
  tenant_name: displayNameField("tenant_name"),
  verify_url: httpUrlField("verify_url"),
});

export type ReaderEmailVerificationData = z.output<
  typeof readerEmailVerificationDataSchema
>;

export interface ReaderEmailVerificationEmailProps {
  data: ReaderEmailVerificationData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const readerEmailVerificationSubject = (
  data: ReaderEmailVerificationData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_email_verification.subject", {
    tenant_name: data.tenant_name,
  });

export const readerEmailVerificationPreview = (
  _data: ReaderEmailVerificationData,
  messages: Messages
): string => emailMessage(messages, "email.reader_email_verification.preview");

export const ReaderEmailVerificationEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: ReaderEmailVerificationEmailProps) => (
  <EmailLayout
    locale={locale}
    messages={messages}
    preview={readerEmailVerificationPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_email_verification.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.reader_email_verification.intro")}
    </EmailIntro>
    <EmailBody>
      {emailMessage(messages, "email.reader_email_verification.body")}
    </EmailBody>
    <EmailButton href={data.verify_url}>
      {emailMessage(messages, "email.reader_email_verification.action")}
    </EmailButton>
    <EmailMeta>
      {emailMessage(messages, "email.reader_email_verification.expires", {
        expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
      })}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(messages, "email.reader_email_verification.ignore")}
    </EmailMeta>
    <EmailFallbackLink href={data.verify_url}>
      {emailMessage(messages, "email.reader_email_verification.fallback_link")}
    </EmailFallbackLink>
  </EmailLayout>
);
