import type { PlatformCommunityLimits } from "#lib/platform-policy";

import { PolicyForm } from "../../_components/policy-form";
import { updatePlatformCommunityLimitsAction } from "../../_lib/policy-actions";

export const CommunityLimitsForm = ({
  values,
  revision,
  loadErrorMessage,
}: {
  values: PlatformCommunityLimits;
  revision: string;
  loadErrorMessage?: string;
}) => (
  <PolicyForm
    action={updatePlatformCommunityLimitsAction}
    description="platform.policy.community.description"
    fields={[
      {
        defaultValue: values.commentPost.perMinute,
        label: "platform.policy.community.comment_post_per_minute",
        name: "comment_post_per_minute",
      },
      {
        defaultValue: values.commentPost.perDay,
        label: "platform.policy.community.comment_post_per_day",
        name: "comment_post_per_day",
      },
      {
        defaultValue: values.commentReport.perMinute,
        label: "platform.policy.community.comment_report_per_minute",
        name: "comment_report_per_minute",
      },
      {
        defaultValue: values.commentReport.perDay,
        label: "platform.policy.community.comment_report_per_day",
        name: "comment_report_per_day",
      },
      {
        defaultValue: values.contactMessagePerAccount.perHour,
        label: "platform.policy.community.contact_account_per_hour",
        name: "contact_message_per_account_per_hour",
      },
      {
        defaultValue: values.contactMessagePerAccount.perDay,
        label: "platform.policy.community.contact_account_per_day",
        name: "contact_message_per_account_per_day",
      },
      {
        defaultValue: values.contactMessagePerClient.perHour,
        label: "platform.policy.community.contact_client_per_hour",
        name: "contact_message_per_client_per_hour",
      },
      {
        defaultValue: values.contactMessagePerClient.perDay,
        label: "platform.policy.community.contact_client_per_day",
        name: "contact_message_per_client_per_day",
      },
      {
        defaultValue: values.episodeRating.perMinute,
        label: "platform.policy.community.episode_rating_per_minute",
        name: "episode_rating_per_minute",
      },
      {
        defaultValue: values.episodeRating.perDay,
        label: "platform.policy.community.episode_rating_per_day",
        name: "episode_rating_per_day",
      },
      {
        defaultValue: values.viewerPreferences.perMinute,
        label: "platform.policy.community.viewer_preferences_per_minute",
        name: "viewer_preferences_per_minute",
      },
      {
        defaultValue: values.viewerPreferences.perDay,
        label: "platform.policy.community.viewer_preferences_per_day",
        name: "viewer_preferences_per_day",
      },
      {
        defaultValue: values.duplicateCommentWindowMinutes,
        label: "platform.policy.community.duplicate_window",
        name: "duplicate_comment_window_minutes",
      },
    ]}
    help="platform.policy.community.help"
    loadErrorMessage={loadErrorMessage}
    revision={revision}
    submit="platform.policy.community.save"
    title="platform.policy.community.title"
  />
);
