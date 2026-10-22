import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { EmailButton } from "../button";
import { EmailLayout } from "../layout";
import { emailMessage } from "../messages";
import type { Messages } from "../messages";
import {
  EmailDetail,
  EmailFallbackLink,
  EmailHeading,
  EmailIntro,
} from "../text";
import { catalogTitleField, displayNameField, httpUrlField } from "./fields";

export const readerEpisodePublishedDataSchema = z.object({
  episode_title: catalogTitleField("episode_title"),
  episode_url: httpUrlField("episode_url"),
  series_title: catalogTitleField("series_title"),
  settings_url: httpUrlField("settings_url"),
  tenant_name: displayNameField("tenant_name"),
});

export type ReaderEpisodePublishedData = z.output<
  typeof readerEpisodePublishedDataSchema
>;

export interface ReaderEpisodePublishedEmailProps {
  data: ReaderEpisodePublishedData;
  locale: Locale;
  messages: Messages;
}

export const readerEpisodePublishedPreview = (
  data: ReaderEpisodePublishedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_episode_published.preview", {
    episode_title: data.episode_title,
  });

/**
 * The mail that tells a reader an episode they asked to hear about is out:
 * one of a series or by an author they follow. Like every notification mail,
 * it ends on the settings where the reader chooses which of them they receive.
 */
export const ReaderEpisodePublishedEmail = ({
  data,
  locale,
  messages,
}: ReaderEpisodePublishedEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerEpisodePublishedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_episode_published.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.reader_episode_published.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    <EmailDetail>
      {emailMessage(messages, "email.reader_episode_published.series", {
        series_title: data.series_title,
      })}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.reader_episode_published.episode", {
        episode_title: data.episode_title,
      })}
    </EmailDetail>
    <EmailButton href={data.episode_url}>
      {emailMessage(messages, "email.reader_episode_published.action")}
    </EmailButton>
    <EmailFallbackLink href={data.episode_url}>
      {emailMessage(messages, "email.reader_episode_published.fallback_link")}
    </EmailFallbackLink>
    <EmailFallbackLink href={data.settings_url}>
      {emailMessage(messages, "email.reader_episode_published.preferences")}
    </EmailFallbackLink>
  </EmailLayout>
);
