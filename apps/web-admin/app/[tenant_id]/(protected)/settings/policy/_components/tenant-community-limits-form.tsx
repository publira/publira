import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type {
  TenantCommunityLimitOverrides,
  TenantCommunityLimits,
} from "#lib/tenant-community-limits";
import {
  MAX_DUPLICATE_COMMENT_WINDOW_MINUTES,
  MIN_POLICY_VALUE,
} from "#lib/tenant-policy-shared";

import { updateTenantCommunityLimitsAction } from "../_lib/actions";
import * as PolicyOverride from "./policy-override-group";

interface TenantCommunityLimitsFormProps {
  canEdit: boolean;
  loadErrorMessage?: string;
  overrides: TenantCommunityLimitOverrides;
  /** The limits every absent override follows, and may not be looser than. */
  platformDefaults: TenantCommunityLimits;
  /** The stored row's version, sent back so a stale save is refused. */
  revision: string;
  tenantId: string;
}

/** A limit with no override shows the platform value, which is the loosest a save accepts. */
export const TenantCommunityLimitsForm = ({
  canEdit,
  loadErrorMessage,
  overrides,
  platformDefaults,
  revision,
  tenantId,
}: TenantCommunityLimitsFormProps) => {
  // A failed read has no stored limits, so a save from here would write values
  // nobody chose. Editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.policy.community.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.policy.community.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantCommunityLimitsAction}
        className="grid gap-4 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="revision" type="hidden" value={revision} />

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          <PolicyOverride.Root
            initialUseDefault={overrides.commentPost === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.comment_post_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_minute_day"
                  values={{
                    per_day: String(platformDefaults.commentPost.perDay),
                    per_minute: String(platformDefaults.commentPost.perMinute),
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_post_per_minute" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (overrides.commentPost ?? platformDefaults.commentPost)
                        .perMinute
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="comment_post_per_minute"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_post_per_day" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (overrides.commentPost ?? platformDefaults.commentPost)
                        .perDay
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="comment_post_per_day"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.commentReport === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.comment_report_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_minute_day"
                  values={{
                    per_day: String(platformDefaults.commentReport.perDay),
                    per_minute: String(
                      platformDefaults.commentReport.perMinute
                    ),
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_report_per_minute" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.commentReport ??
                        platformDefaults.commentReport
                      ).perMinute
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="comment_report_per_minute"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_report_per_day" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.commentReport ??
                        platformDefaults.commentReport
                      ).perDay
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="comment_report_per_day"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={
              overrides.duplicateCommentWindowMinutes === undefined
            }
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.duplicate_window_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_window"
                  values={{
                    minutes: platformDefaults.duplicateCommentWindowMinutes,
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.duplicate_window_label" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      overrides.duplicateCommentWindowMinutes ??
                      platformDefaults.duplicateCommentWindowMinutes
                    }
                    inputMode="numeric"
                    max={MAX_DUPLICATE_COMMENT_WINDOW_MINUTES}
                    min={MIN_POLICY_VALUE}
                    name="duplicate_comment_window_minutes"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
            <PolicyOverride.Description>
              <Suspense fallback={<SkeletonLine className="h-3 w-3/4" />}>
                <Message message="admin.settings.policy.community.duplicate_window_description" />
              </Suspense>
            </PolicyOverride.Description>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.episodeRating === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.episode_rating_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_minute_day"
                  values={{
                    per_day: String(platformDefaults.episodeRating.perDay),
                    per_minute: String(
                      platformDefaults.episodeRating.perMinute
                    ),
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.episode_rating_per_minute" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.episodeRating ??
                        platformDefaults.episodeRating
                      ).perMinute
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="episode_rating_per_minute"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.episode_rating_per_day" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.episodeRating ??
                        platformDefaults.episodeRating
                      ).perDay
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="episode_rating_per_day"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.contactMessagePerAccount === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.contact_per_account_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_hour_day"
                  values={{
                    per_day: String(
                      platformDefaults.contactMessagePerAccount.perDay
                    ),
                    per_hour: String(
                      platformDefaults.contactMessagePerAccount.perHour
                    ),
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_account_per_hour" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.contactMessagePerAccount ??
                        platformDefaults.contactMessagePerAccount
                      ).perHour
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="contact_message_per_account_per_hour"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_account_per_day" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.contactMessagePerAccount ??
                        platformDefaults.contactMessagePerAccount
                      ).perDay
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="contact_message_per_account_per_day"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.contactMessagePerClient === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.contact_per_client_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_hour_day"
                  values={{
                    per_day: String(
                      platformDefaults.contactMessagePerClient.perDay
                    ),
                    per_hour: String(
                      platformDefaults.contactMessagePerClient.perHour
                    ),
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_client_per_hour" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.contactMessagePerClient ??
                        platformDefaults.contactMessagePerClient
                      ).perHour
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="contact_message_per_client_per_hour"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_client_per_day" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.contactMessagePerClient ??
                        platformDefaults.contactMessagePerClient
                      ).perDay
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="contact_message_per_client_per_day"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.viewerPreferences === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.viewer_preferences_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_minute_day"
                  values={{
                    per_day: String(platformDefaults.viewerPreferences.perDay),
                    per_minute: String(
                      platformDefaults.viewerPreferences.perMinute
                    ),
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.viewer_preferences_per_minute" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.viewerPreferences ??
                        platformDefaults.viewerPreferences
                      ).perMinute
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="viewer_preferences_per_minute"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.viewer_preferences_per_day" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.viewerPreferences ??
                        platformDefaults.viewerPreferences
                      ).perDay
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="viewer_preferences_per_day"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.notificationSettings === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.notification_settings_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_minute_day"
                  values={{
                    per_day: String(
                      platformDefaults.notificationSettings.perDay
                    ),
                    per_minute: String(
                      platformDefaults.notificationSettings.perMinute
                    ),
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.notification_settings_per_minute" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.notificationSettings ??
                        platformDefaults.notificationSettings
                      ).perMinute
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="notification_settings_per_minute"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.notification_settings_per_day" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      (
                        overrides.notificationSettings ??
                        platformDefaults.notificationSettings
                      ).perDay
                    }
                    inputMode="numeric"
                    min={MIN_POLICY_VALUE}
                    name="notification_settings_per_day"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>
        </ActionForm.Fieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="admin.settings.policy.community.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.policy.community.submit" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
