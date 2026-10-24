import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformRetentionDefaults } from "#lib/platform-policy";

import { PolicyLimitField } from "../../_components/policy-limit-field";
import { updatePlatformRetentionDefaultsAction } from "../../_lib/actions";
import { MIN_CONTENT_EVENT_DAYS } from "../../_lib/form-schemas";

export const RetentionDefaultsForm = ({
  values,
  revision,
  loadErrorMessage,
}: {
  values: PlatformRetentionDefaults;
  revision: string;
  loadErrorMessage?: string;
}) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="platform.policy.retention.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.retention.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root
      action={updatePlatformRetentionDefaultsAction}
      className="grid gap-4 sm:max-w-3xl"
    >
      <input name="revision" type="hidden" value={revision} />
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
          <Message message="platform.policy.retention.help" />
        </Suspense>
      </p>
      {/* A save refreshes the policy; the new revision remounts the fields
          instead of changing a mounted field's default. */}
      <div className="grid gap-4 sm:grid-cols-2" key={revision}>
        <PolicyLimitField
          defaultValue={values.contentEventDays}
          disabled={Boolean(loadErrorMessage)}
          min={MIN_CONTENT_EVENT_DAYS}
          name="content_event_days"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.retention.content_event_label" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.dailyRankingSnapshotDays}
          disabled={Boolean(loadErrorMessage)}
          name="daily_ranking_snapshot_days"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.retention.daily_ranking_label" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.weeklyRankingSnapshotDays}
          disabled={Boolean(loadErrorMessage)}
          name="weekly_ranking_snapshot_days"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.retention.weekly_ranking_label" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.withdrawnCommentDays}
          disabled={Boolean(loadErrorMessage)}
          name="withdrawn_comment_days"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.retention.withdrawn_comment_label" />
          </Suspense>
        </PolicyLimitField>
      </div>
      {loadErrorMessage ? (
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}
      <div className="mt-2 flex justify-end">
        <ActionForm.Submit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.policy.retention.save" />
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
