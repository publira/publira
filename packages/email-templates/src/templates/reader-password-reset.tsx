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

export const readerPasswordResetDataSchema = z.object({
  expires_at: instantField("expires_at"),
  reset_url: httpUrlField("reset_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderPasswordResetData = z.output<
  typeof readerPasswordResetDataSchema
>;

export interface ReaderPasswordResetEmailProps {
  data: ReaderPasswordResetData;
  locale: Locale;
  messages: Messages;
  timeZone: string;
}

export const readerPasswordResetSubject = (
  data: ReaderPasswordResetData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_password_reset.subject", {
    tenant_name: data.tenant_name,
  });

export const readerPasswordResetPreview = (
  _data: ReaderPasswordResetData,
  messages: Messages
): string => emailMessage(messages, "email.reader_password_reset.preview");

export const ReaderPasswordResetEmail = ({
  data,
  locale,
  messages,
  timeZone,
}: ReaderPasswordResetEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerPasswordResetPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_password_reset.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.reader_password_reset.intro")}
    </EmailIntro>
    <EmailBody>
      {emailMessage(messages, "email.reader_password_reset.body")}
    </EmailBody>
    <EmailButton href={data.reset_url}>
      {emailMessage(messages, "email.reader_password_reset.action")}
    </EmailButton>
    <EmailMeta>
      {emailMessage(messages, "email.reader_password_reset.expires", {
        expires_at: formatDateTime(data.expires_at, { locale, timeZone }),
      })}
    </EmailMeta>
    <EmailMeta>
      {emailMessage(messages, "email.reader_password_reset.ignore")}
    </EmailMeta>
    <EmailFallbackLink href={data.reset_url}>
      {emailMessage(messages, "email.reader_password_reset.fallback_link")}
    </EmailFallbackLink>
  </EmailLayout>
);
