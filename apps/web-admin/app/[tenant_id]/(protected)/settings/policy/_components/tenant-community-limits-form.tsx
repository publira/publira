import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
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
import {
  PolicyOverrideDescription,
  PolicyOverrideGroup,
  PolicyOverrideLegend,
  PolicyOverridePlatformValue,
  PolicyOverrideUseDefault,
  PolicyOverrideValues,
} from "./policy-override-group";

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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.policy.community.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.policy.community.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantCommunityLimitsAction}
        className="grid gap-4 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="revision" type="hidden" value={revision} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <PolicyOverrideGroup
            initialUseDefault={overrides.commentPost === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.comment_post_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_minute_day"
                  values={{
                    per_day: String(platformDefaults.commentPost.perDay),
                    per_minute: String(platformDefaults.commentPost.perMinute),
                  }}
                />
              </Suspense>
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_post_per_minute" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_post_per_day" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={overrides.commentReport === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.comment_report_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
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
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_report_per_minute" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.comment_report_per_day" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={
              overrides.duplicateCommentWindowMinutes === undefined
            }
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.duplicate_window_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message
                  message="admin.settings.policy.community.platform_window"
                  values={{
                    minutes: platformDefaults.duplicateCommentWindowMinutes,
                  }}
                />
              </Suspense>
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.duplicate_window_label" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
            <PolicyOverrideDescription>
              <Suspense fallback={<SkeletonLine className="h-3 w-3/4" />}>
                <Message message="admin.settings.policy.community.duplicate_window_description" />
              </Suspense>
            </PolicyOverrideDescription>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={overrides.episodeRating === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.episode_rating_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
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
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.episode_rating_per_minute" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.episode_rating_per_day" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={overrides.contactMessagePerAccount === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.contact_per_account_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
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
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_account_per_hour" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_account_per_day" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={overrides.contactMessagePerClient === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.contact_per_client_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
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
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_client_per_hour" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.contact_client_per_day" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={overrides.viewerPreferences === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.community.viewer_preferences_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
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
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.viewer_preferences_per_minute" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.policy.community.viewer_preferences_per_day" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
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
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>
        </ActionFormFieldset>

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
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ActionFormIdle>
                <Message message="admin.settings.policy.community.submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.saving" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
