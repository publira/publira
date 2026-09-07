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
import {
  accountStateField,
  displayNameField,
  emailAddressField,
  httpUrlField,
} from "./fields";

export const readerSignupAttemptNoticeDataSchema = z.object({
  account_state: accountStateField(),
  action_url: httpUrlField("action_url"),
  email: emailAddressField("email"),
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
}: ReaderSignupAttemptNoticeEmailProps) => {
  const confirmed = data.account_state === "confirmed";

  return (
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
        {emailMessage(
          messages,
          confirmed
            ? "email.reader_signup_attempt_notice.body_confirmed"
            : "email.reader_signup_attempt_notice.body_unconfirmed"
        )}
      </EmailBody>
      <EmailDetail>
        {emailMessage(messages, "email.reader_signup_attempt_notice.email", {
          email: data.email,
        })}
      </EmailDetail>
      <EmailButton href={data.action_url}>
        {emailMessage(
          messages,
          confirmed
            ? "email.reader_signup_attempt_notice.action_confirmed"
            : "email.reader_signup_attempt_notice.action_unconfirmed"
        )}
      </EmailButton>
      <EmailMeta>
        {emailMessage(
          messages,
          confirmed
            ? "email.reader_signup_attempt_notice.forgot_confirmed"
            : "email.reader_signup_attempt_notice.forgot_unconfirmed"
        )}
      </EmailMeta>
      <EmailMeta>
        {emailMessage(messages, "email.reader_signup_attempt_notice.ignore")}
      </EmailMeta>
      <EmailFallbackLink href={data.action_url}>
        {emailMessage(
          messages,
          "email.reader_signup_attempt_notice.fallback_link"
        )}
      </EmailFallbackLink>
    </EmailLayout>
  );
};
