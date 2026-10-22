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
} from "../text";
import { catalogTitleField, displayNameField, httpUrlField } from "./fields";

export const readerCommentApprovedDataSchema = z.object({
  episode_title: catalogTitleField("episode_title"),
  episode_url: httpUrlField("episode_url"),
  series_title: catalogTitleField("series_title"),
  settings_url: httpUrlField("settings_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderCommentApprovedData = z.output<
  typeof readerCommentApprovedDataSchema
>;

export interface ReaderCommentApprovedEmailProps {
  data: ReaderCommentApprovedData;
  locale: Locale;
  messages: Messages;
}

export const readerCommentApprovedPreview = (
  data: ReaderCommentApprovedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_comment_approved.preview", {
    episode_title: data.episode_title,
  });

/**
 * The mail that tells a reader the comment they posted was approved and is
 * now public, naming the episode it is on. It quotes no comment: the reader
 * wrote it, and the episode page shows it where everyone else reads it.
 */
export const ReaderCommentApprovedEmail = ({
  data,
  locale,
  messages,
}: ReaderCommentApprovedEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerCommentApprovedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_comment_approved.heading")}
    </EmailHeading>
    <EmailBody>
      {emailMessage(messages, "email.reader_comment_approved.body")}
    </EmailBody>
    <EmailDetail>
      {emailMessage(messages, "email.reader_comment_approved.series", {
        series_title: data.series_title,
      })}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.reader_comment_approved.episode", {
        episode_title: data.episode_title,
      })}
    </EmailDetail>
    <EmailButton href={data.episode_url}>
      {emailMessage(messages, "email.reader_comment_approved.action")}
    </EmailButton>
    <EmailFallbackLink href={data.episode_url}>
      {emailMessage(messages, "email.reader_comment_approved.fallback_link")}
    </EmailFallbackLink>
    <EmailFallbackLink href={data.settings_url}>
      {emailMessage(messages, "email.reader_comment_approved.preferences")}
    </EmailFallbackLink>
  </EmailLayout>
);
