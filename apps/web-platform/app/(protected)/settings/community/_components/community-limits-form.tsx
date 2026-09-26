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
import type { PlatformCommunityLimits } from "#lib/platform-policy";

import { PolicyLimitField } from "../../_components/policy-limit-field";
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
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="platform.policy.community.title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.community.description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>
    <ActionForm
      action={updatePlatformCommunityLimitsAction}
      className="grid gap-4 sm:max-w-3xl"
    >
      <input name="revision" type="hidden" value={revision} />
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-80" />}>
          <Message message="platform.policy.community.help" />
        </Suspense>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PolicyLimitField
          defaultValue={values.commentPost.perMinute}
          disabled={Boolean(loadErrorMessage)}
          name="comment_post_per_minute"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.comment_post_per_minute" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.commentPost.perDay}
          disabled={Boolean(loadErrorMessage)}
          name="comment_post_per_day"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.comment_post_per_day" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.commentReport.perMinute}
          disabled={Boolean(loadErrorMessage)}
          name="comment_report_per_minute"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.comment_report_per_minute" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.commentReport.perDay}
          disabled={Boolean(loadErrorMessage)}
          name="comment_report_per_day"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.comment_report_per_day" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.contactMessagePerAccount.perHour}
          disabled={Boolean(loadErrorMessage)}
          name="contact_message_per_account_per_hour"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.contact_account_per_hour" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.contactMessagePerAccount.perDay}
          disabled={Boolean(loadErrorMessage)}
          name="contact_message_per_account_per_day"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.contact_account_per_day" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.contactMessagePerClient.perHour}
          disabled={Boolean(loadErrorMessage)}
          name="contact_message_per_client_per_hour"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.contact_client_per_hour" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.contactMessagePerClient.perDay}
          disabled={Boolean(loadErrorMessage)}
          name="contact_message_per_client_per_day"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.contact_client_per_day" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.episodeRating.perMinute}
          disabled={Boolean(loadErrorMessage)}
          name="episode_rating_per_minute"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.episode_rating_per_minute" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.episodeRating.perDay}
          disabled={Boolean(loadErrorMessage)}
          name="episode_rating_per_day"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.episode_rating_per_day" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.viewerPreferences.perMinute}
          disabled={Boolean(loadErrorMessage)}
          name="viewer_preferences_per_minute"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.viewer_preferences_per_minute" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.viewerPreferences.perDay}
          disabled={Boolean(loadErrorMessage)}
          name="viewer_preferences_per_day"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.viewer_preferences_per_day" />
          </Suspense>
        </PolicyLimitField>
        <PolicyLimitField
          defaultValue={values.duplicateCommentWindowMinutes}
          disabled={Boolean(loadErrorMessage)}
          name="duplicate_comment_window_minutes"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.policy.community.duplicate_window" />
          </Suspense>
        </PolicyLimitField>
      </div>
      {loadErrorMessage ? (
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}
      <div className="mt-2 flex justify-end">
        <ActionFormSubmit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.policy.community.save" />
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </PlatformSection>
);
