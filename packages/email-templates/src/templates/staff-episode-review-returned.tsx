import type { Locale } from "@publira/i18n";
import type { JSX } from "react";
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
  EmailQuote,
} from "../text";
import {
  catalogTitleField,
  displayNameField,
  httpUrlField,
  quotedTextField,
} from "./fields";

export const staffEpisodeReviewReturnedDataSchema: z.ZodObject<
  {
    comment: z.ZodString;
    episode_title: z.ZodString;
    episode_url: z.ZodString;
    series_title: z.ZodString;
    tenant_name: z.ZodString;
  },
  z.core.$strip
> = z.object({
  comment: quotedTextField("comment", 2000),
  episode_title: catalogTitleField("episode_title"),
  episode_url: httpUrlField("episode_url"),
  series_title: catalogTitleField("series_title"),
  tenant_name: displayNameField("tenant_name"),
});

export type StaffEpisodeReviewReturnedData = z.output<
  typeof staffEpisodeReviewReturnedDataSchema
>;

export interface StaffEpisodeReviewReturnedEmailProps {
  data: StaffEpisodeReviewReturnedData;
  locale: Locale;
  messages: Messages;
}

export const staffEpisodeReviewReturnedPreview = (
  data: StaffEpisodeReviewReturnedData,
  messages: Messages
): string =>
  emailMessage(messages, "email.staff_episode_review_returned.preview", {
    episode_title: data.episode_title,
  });

/**
 * The mail that tells a member of staff a Tenant admin sent the episode they
 * submitted for review back. The comment is what they act on, so it travels
 * with the mail, and the button opens the episode in the console.
 */
export const StaffEpisodeReviewReturnedEmail = ({
  data,
  locale,
  messages,
}: StaffEpisodeReviewReturnedEmailProps): JSX.Element => (
  <EmailLayout
    brand={data.tenant_name}
    locale={locale}
    messages={messages}
    preview={staffEpisodeReviewReturnedPreview(data, messages)}
  >
    <EmailHeading>
      {emailMessage(messages, "email.staff_episode_review_returned.heading")}
    </EmailHeading>
    <EmailIntro>
      {emailMessage(messages, "email.staff_episode_review_returned.intro", {
        tenant_name: data.tenant_name,
      })}
    </EmailIntro>
    <EmailDetail>
      {emailMessage(messages, "email.staff_episode_review_returned.series", {
        series_title: data.series_title,
      })}
    </EmailDetail>
    <EmailDetail>
      {emailMessage(messages, "email.staff_episode_review_returned.episode", {
        episode_title: data.episode_title,
      })}
    </EmailDetail>
    <EmailHeading>
      {emailMessage(
        messages,
        "email.staff_episode_review_returned.comment_heading"
      )}
    </EmailHeading>
    <EmailQuote>{data.comment}</EmailQuote>
    <EmailButton href={data.episode_url}>
      {emailMessage(messages, "email.staff_episode_review_returned.action")}
    </EmailButton>
    <EmailFallbackLink href={data.episode_url}>
      {emailMessage(
        messages,
        "email.staff_episode_review_returned.fallback_link"
      )}
    </EmailFallbackLink>
  </EmailLayout>
);
