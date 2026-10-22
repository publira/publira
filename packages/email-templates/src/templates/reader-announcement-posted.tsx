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
  EmailMeta,
} from "../text";
import { catalogTitleField, displayNameField, httpUrlField } from "./fields";

export const readerAnnouncementPostedDataSchema = z
  .object({
    announcement_title: catalogTitleField("announcement_title"),
    announcements_url: httpUrlField("announcements_url"),
    /**
     * Whether the tenant sent the announcement to every reader, whatever
     * their notification settings say.
     */
    sent_to_everyone: z.boolean({
      error: "sent_to_everyone must be a boolean",
    }),
    /** Left out for an announcement sent to everyone, which links no settings. */
    settings_url: httpUrlField("settings_url").optional(),
    tenant_name: displayNameField("tenant_name"),
  })
  .refine((data) => data.sent_to_everyone || data.settings_url !== undefined, {
    error: "settings_url is required unless sent_to_everyone",
    path: ["settings_url"],
  });

export type ReaderAnnouncementPostedData = z.output<
  typeof readerAnnouncementPostedDataSchema
>;

export interface ReaderAnnouncementPostedEmailProps {
  data: ReaderAnnouncementPostedData;
  locale: Locale;
  messages: Messages;
}

export const readerAnnouncementPostedPreview = (
  data: ReaderAnnouncementPostedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.reader_announcement_posted.preview", {
    tenant_name: data.tenant_name,
  });

/**
 * The mail that carries the title of an announcement the tenant posted, and
 * takes the reader to the announcements inbox for the rest. One sent to every
 * reader says so in place of the settings link, since no setting could have
 * kept it out.
 */
export const ReaderAnnouncementPostedEmail = ({
  data,
  locale,
  messages,
}: ReaderAnnouncementPostedEmailProps) => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={readerAnnouncementPostedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.reader_announcement_posted.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.reader_announcement_posted.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    <EmailDetail>
      {emailMessage(messages, "email.reader_announcement_posted.title", {
        announcement_title: data.announcement_title,
      })}
    </EmailDetail>
    <EmailButton href={data.announcements_url}>
      {emailMessage(messages, "email.reader_announcement_posted.action")}
    </EmailButton>
    <EmailFallbackLink href={data.announcements_url}>
      {emailMessage(messages, "email.reader_announcement_posted.fallback_link")}
    </EmailFallbackLink>
    {data.sent_to_everyone || data.settings_url === undefined ? (
      <EmailMeta>
        {emailMessage(messages, "email.reader_announcement_posted.everyone", {
          tenant_name: data.tenant_name,
        })}
      </EmailMeta>
    ) : (
      <EmailFallbackLink href={data.settings_url}>
        {emailMessage(messages, "email.reader_announcement_posted.preferences")}
      </EmailFallbackLink>
    )}
  </EmailLayout>
);
