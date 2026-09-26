import {
  ActionForm,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import type { PlatformRetentionDefaults } from "#lib/platform-policy";

import { PolicyLimitField } from "../../_components/policy-limit-field";
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
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="platform.policy.retention.title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.retention.description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>
    <ActionForm
      action={updatePlatformRetentionDefaultsAction}
      className="grid gap-4 sm:max-w-3xl"
    >
      <input name="revision" type="hidden" value={revision} />
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
          <Message message="platform.policy.retention.help" />
        </Suspense>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PolicyLimitField
          defaultValue={values.contentEventDays}
          disabled={Boolean(loadErrorMessage)}
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
        <ActionFormSubmit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.policy.retention.save" />
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </PlatformSection>
);
