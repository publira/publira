"use client";

import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useState } from "react";

import type { FormActionState } from "#components/action-form";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import type {
  TenantCommunityLimitOverrides,
  TenantCommunityLimits,
} from "#lib/tenant-community-limits";
import type { HourDayLimit, MinuteDayLimit } from "#lib/tenant-policy-shared";
import {
  MAX_DUPLICATE_COMMENT_WINDOW_MINUTES,
  MIN_POLICY_VALUE,
} from "#lib/tenant-policy-shared";
import { useTenantId } from "#lib/use-tenant-id";

import { PolicyOverrideGroup } from "./policy-override-group";

interface TenantCommunityLimitsFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  canEdit: boolean;
  loadErrorMessage?: string;
  overrides: TenantCommunityLimitOverrides;
  /** The limits every absent override follows, and may not be looser than. */
  platformDefaults: TenantCommunityLimits;
  /** The stored row's version, sent back so a stale save is refused. */
  revision: string;
}

interface MinuteDayField {
  perDay: string;
  perMinute: string;
  useDefault: boolean;
}

interface HourDayField {
  perDay: string;
  perHour: string;
  useDefault: boolean;
}

interface WindowField {
  minutes: string;
  useDefault: boolean;
}

interface CommunityLimitFields {
  commentPost: MinuteDayField;
  commentReport: MinuteDayField;
  contactMessagePerAccount: HourDayField;
  contactMessagePerClient: HourDayField;
  duplicateCommentWindow: WindowField;
  episodeRating: MinuteDayField;
  viewerPreferences: MinuteDayField;
}

/** An unsaved limit starts on the platform value, which is the loosest a save accepts. */
const toMinuteDayField = (
  override: MinuteDayLimit | undefined,
  platformDefault: MinuteDayLimit
): MinuteDayField => ({
  perDay: String((override ?? platformDefault).perDay),
  perMinute: String((override ?? platformDefault).perMinute),
  useDefault: override === undefined,
});

const toHourDayField = (
  override: HourDayLimit | undefined,
  platformDefault: HourDayLimit
): HourDayField => ({
  perDay: String((override ?? platformDefault).perDay),
  perHour: String((override ?? platformDefault).perHour),
  useDefault: override === undefined,
});

const SubmitLabel = ({ isPending }: { isPending: boolean }) =>
  isPending ? (
    <ClientMessage message="admin.settings.saving" />
  ) : (
    <ClientMessage message="admin.settings.policy.community.submit" />
  );

export const TenantCommunityLimitsForm = ({
  action,
  canEdit,
  loadErrorMessage,
  overrides,
  platformDefaults,
  revision,
}: TenantCommunityLimitsFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [limits, setLimits] = useState<CommunityLimitFields>(() => ({
    commentPost: toMinuteDayField(
      overrides.commentPost,
      platformDefaults.commentPost
    ),
    commentReport: toMinuteDayField(
      overrides.commentReport,
      platformDefaults.commentReport
    ),
    contactMessagePerAccount: toHourDayField(
      overrides.contactMessagePerAccount,
      platformDefaults.contactMessagePerAccount
    ),
    contactMessagePerClient: toHourDayField(
      overrides.contactMessagePerClient,
      platformDefaults.contactMessagePerClient
    ),
    duplicateCommentWindow: {
      minutes: String(
        overrides.duplicateCommentWindowMinutes ??
          platformDefaults.duplicateCommentWindowMinutes
      ),
      useDefault: overrides.duplicateCommentWindowMinutes === undefined,
    },
    episodeRating: toMinuteDayField(
      overrides.episodeRating,
      platformDefaults.episodeRating
    ),
    viewerPreferences: toMinuteDayField(
      overrides.viewerPreferences,
      platformDefaults.viewerPreferences
    ),
  }));

  const update = <K extends keyof CommunityLimitFields>(
    key: K,
    patch: Partial<CommunityLimitFields[K]>
  ) => {
    setLimits((previous) => ({
      ...previous,
      [key]: { ...previous[key], ...patch },
    }));
  };

  // A failed read has no stored limits, so a save from here would write values
  // nobody chose. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const controlsDisabled = !canEdit || hasLoadError || isPending;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.policy.community.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.policy.community.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-3xl">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="revision" type="hidden" value={revision} />

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.community.comment_post_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("commentPost", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.community.platform_minute_day"
              values={{
                per_day: String(platformDefaults.commentPost.perDay),
                per_minute: String(platformDefaults.commentPost.perMinute),
              }}
            />
          }
          useDefault={limits.commentPost.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.comment_post_per_minute" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={controlsDisabled || limits.commentPost.useDefault}
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="comment_post_per_minute"
                onChange={(event) =>
                  update("commentPost", { perMinute: event.target.value })
                }
                step={1}
                type="number"
                value={limits.commentPost.perMinute}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.comment_post_per_day" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={controlsDisabled || limits.commentPost.useDefault}
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="comment_post_per_day"
                onChange={(event) =>
                  update("commentPost", { perDay: event.target.value })
                }
                step={1}
                type="number"
                value={limits.commentPost.perDay}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.community.comment_report_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("commentReport", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.community.platform_minute_day"
              values={{
                per_day: String(platformDefaults.commentReport.perDay),
                per_minute: String(platformDefaults.commentReport.perMinute),
              }}
            />
          }
          useDefault={limits.commentReport.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.comment_report_per_minute" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={controlsDisabled || limits.commentReport.useDefault}
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="comment_report_per_minute"
                onChange={(event) =>
                  update("commentReport", { perMinute: event.target.value })
                }
                step={1}
                type="number"
                value={limits.commentReport.perMinute}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.comment_report_per_day" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={controlsDisabled || limits.commentReport.useDefault}
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="comment_report_per_day"
                onChange={(event) =>
                  update("commentReport", { perDay: event.target.value })
                }
                step={1}
                type="number"
                value={limits.commentReport.perDay}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          description={
            <ClientMessage message="admin.settings.policy.community.duplicate_window_description" />
          }
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.community.duplicate_window_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("duplicateCommentWindow", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.community.platform_window"
              values={{
                minutes: String(platformDefaults.duplicateCommentWindowMinutes),
              }}
            />
          }
          useDefault={limits.duplicateCommentWindow.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.duplicate_window_label" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || limits.duplicateCommentWindow.useDefault
                }
                inputMode="numeric"
                max={MAX_DUPLICATE_COMMENT_WINDOW_MINUTES}
                min={MIN_POLICY_VALUE}
                name="duplicate_comment_window_minutes"
                onChange={(event) =>
                  update("duplicateCommentWindow", {
                    minutes: event.target.value,
                  })
                }
                step={1}
                type="number"
                value={limits.duplicateCommentWindow.minutes}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.community.episode_rating_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("episodeRating", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.community.platform_minute_day"
              values={{
                per_day: String(platformDefaults.episodeRating.perDay),
                per_minute: String(platformDefaults.episodeRating.perMinute),
              }}
            />
          }
          useDefault={limits.episodeRating.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.episode_rating_per_minute" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={controlsDisabled || limits.episodeRating.useDefault}
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="episode_rating_per_minute"
                onChange={(event) =>
                  update("episodeRating", { perMinute: event.target.value })
                }
                step={1}
                type="number"
                value={limits.episodeRating.perMinute}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.episode_rating_per_day" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={controlsDisabled || limits.episodeRating.useDefault}
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="episode_rating_per_day"
                onChange={(event) =>
                  update("episodeRating", { perDay: event.target.value })
                }
                step={1}
                type="number"
                value={limits.episodeRating.perDay}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.community.contact_per_account_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("contactMessagePerAccount", { useDefault })
          }
          platformValue={
            <ClientMessage
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
          }
          useDefault={limits.contactMessagePerAccount.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.contact_account_per_hour" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || limits.contactMessagePerAccount.useDefault
                }
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="contact_message_per_account_per_hour"
                onChange={(event) =>
                  update("contactMessagePerAccount", {
                    perHour: event.target.value,
                  })
                }
                step={1}
                type="number"
                value={limits.contactMessagePerAccount.perHour}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.contact_account_per_day" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || limits.contactMessagePerAccount.useDefault
                }
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="contact_message_per_account_per_day"
                onChange={(event) =>
                  update("contactMessagePerAccount", {
                    perDay: event.target.value,
                  })
                }
                step={1}
                type="number"
                value={limits.contactMessagePerAccount.perDay}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.community.contact_per_client_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("contactMessagePerClient", { useDefault })
          }
          platformValue={
            <ClientMessage
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
          }
          useDefault={limits.contactMessagePerClient.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.contact_client_per_hour" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || limits.contactMessagePerClient.useDefault
                }
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="contact_message_per_client_per_hour"
                onChange={(event) =>
                  update("contactMessagePerClient", {
                    perHour: event.target.value,
                  })
                }
                step={1}
                type="number"
                value={limits.contactMessagePerClient.perHour}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.contact_client_per_day" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || limits.contactMessagePerClient.useDefault
                }
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="contact_message_per_client_per_day"
                onChange={(event) =>
                  update("contactMessagePerClient", {
                    perDay: event.target.value,
                  })
                }
                step={1}
                type="number"
                value={limits.contactMessagePerClient.perDay}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.community.viewer_preferences_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("viewerPreferences", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.community.platform_minute_day"
              values={{
                per_day: String(platformDefaults.viewerPreferences.perDay),
                per_minute: String(
                  platformDefaults.viewerPreferences.perMinute
                ),
              }}
            />
          }
          useDefault={limits.viewerPreferences.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.viewer_preferences_per_minute" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || limits.viewerPreferences.useDefault
                }
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="viewer_preferences_per_minute"
                onChange={(event) =>
                  update("viewerPreferences", { perMinute: event.target.value })
                }
                step={1}
                type="number"
                value={limits.viewerPreferences.perMinute}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.community.viewer_preferences_per_day" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || limits.viewerPreferences.useDefault
                }
                inputMode="numeric"
                min={MIN_POLICY_VALUE}
                name="viewer_preferences_per_day"
                onChange={(event) =>
                  update("viewerPreferences", { perDay: event.target.value })
                }
                step={1}
                type="number"
                value={limits.viewerPreferences.perDay}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <ClientMessage message="admin.settings.admin_only" />
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <ClientMessage message="admin.settings.policy.community.load_error_hint" />
            </span>
          </FormMessage>
        ) : null}

        {state ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end">
          <Button disabled={controlsDisabled} type="submit">
            <SubmitLabel isPending={isPending} />
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
