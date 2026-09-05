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
  EmailIntro,
  EmailMeta,
} from "../text";
import { displayNameField, emailAddressField, httpUrlField } from "./fields";

export const readerSignupAttemptNoticeDataSchema = z.object({
  email: emailAddressField("email"),
  reset_url: httpUrlField("reset_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderSignupAttemptNoticeData = z.output<
  typeof readerSignupAttemptNoticeDataSchema
>;

export interface ReaderSignupAttemptNoticeEmailProps {
  data: ReaderSignupAttemptNoticeData;
  locale: Locale;
  messages: Messages;
}

export const readerSignupAttemptNoticeSubject = (
  data: ReaderSignupAttemptNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_signup_attempt_notice.subject", {
    tenant_name: data.tenant_name,
  });

export const readerSignupAttemptNoticePreview = (
  _data: ReaderSignupAttemptNoticeData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_signup_attempt_notice.preview");

export const ReaderSignupAttemptNoticeEmail = ({
  data,
  locale,
  messages,
}: ReaderSignupAttemptNoticeEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerSignupAttemptNoticePreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_signup_attempt_notice.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.reader_signup_attempt_notice.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    <EmailBody>
      {emailMessage(messages, "email.reader_signup_attempt_notice.body")}
    </EmailBody>
    <EmailDetail>
      {emailMessage(messages, "email.reader_signup_attempt_notice.email", {
        email: data.email,
      })}
    </EmailDetail>
    <EmailButton href={data.reset_url}>
      {emailMessage(messages, "email.reader_signup_attempt_notice.action")}
    </EmailButton>
    <EmailMeta>
      {emailMessage(messages, "email.reader_signup_attempt_notice.forgot")}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(messages, "email.reader_signup_attempt_notice.ignore")}
    </EmailMeta>
    <EmailFallbackLink href={data.reset_url}>
      {emailMessage(
        messages,
        "email.reader_signup_attempt_notice.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
