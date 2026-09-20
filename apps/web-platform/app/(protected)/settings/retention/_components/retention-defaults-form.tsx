import type { PlatformRetentionDefaults } from "#lib/platform-policy";

import { PolicyForm } from "../../_components/policy-form";
import { updatePlatformRetentionDefaultsAction } from "../../_lib/policy-actions";

export const RetentionDefaultsForm = ({
  values,
  revision,
  loadErrorMessage,
}: {
  values: PlatformRetentionDefaults;
  revision: string;
  loadErrorMessage?: string;
}) => (
  <PolicyForm
    action={updatePlatformRetentionDefaultsAction}
    description="platform.policy.retention.description"
    fields={[
      {
        defaultValue: values.contentEventDays,
        label: "platform.policy.retention.content_event_label",
        name: "content_event_days",
      },
      {
        defaultValue: values.dailyRankingSnapshotDays,
        label: "platform.policy.retention.daily_ranking_label",
        name: "daily_ranking_snapshot_days",
      },
      {
        defaultValue: values.weeklyRankingSnapshotDays,
        label: "platform.policy.retention.weekly_ranking_label",
        name: "weekly_ranking_snapshot_days",
      },
      {
        defaultValue: values.withdrawnCommentDays,
        label: "platform.policy.retention.withdrawn_comment_label",
        name: "withdrawn_comment_days",
      },
    ]}
    help="platform.policy.retention.help"
    loadErrorMessage={loadErrorMessage}
    revision={revision}
    submit="platform.policy.retention.save"
    title="platform.policy.retention.title"
  />
);
