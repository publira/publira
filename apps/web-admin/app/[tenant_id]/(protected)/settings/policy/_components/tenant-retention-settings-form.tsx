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
import {
  MAX_RETENTION_DAYS,
  MIN_POLICY_VALUE,
} from "#lib/tenant-policy-shared";
import type {
  TenantRetentionOverrides,
  TenantRetentionPeriods,
} from "#lib/tenant-retention-settings";

import { updateTenantRetentionSettingsAction } from "../_lib/actions";
import {
  PolicyOverrideGroup,
  PolicyOverrideLegend,
  PolicyOverridePlatformValue,
  PolicyOverrideUseDefault,
  PolicyOverrideValues,
} from "./policy-override-group";

interface TenantRetentionSettingsFormProps {
  canEdit: boolean;
  loadErrorMessage?: string;
  /** The periods every absent override follows, from the platform settings. */
  platformDefaults: TenantRetentionPeriods;
  overrides: TenantRetentionOverrides;
  /** The stored row's version, sent back so a stale save is refused. */
  revision: string;
  tenantId: string;
}

/** A period with no override shows the platform default, so unticking opens a value to adjust. */
export const TenantRetentionSettingsForm = ({
  canEdit,
  loadErrorMessage,
  overrides,
  platformDefaults,
  revision,
  tenantId,
}: TenantRetentionSettingsFormProps) => {
  // A failed read has no stored periods, so a save from here would write values
  // nobody chose. Editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.policy.retention.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.policy.retention.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantRetentionSettingsAction}
        className="grid gap-4 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="revision" type="hidden" value={revision} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <PolicyOverrideGroup
            initialUseDefault={overrides.withdrawnCommentDays === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.retention.withdrawn_comment_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{
                    days: platformDefaults.withdrawnCommentDays,
                  }}
                />
              </Suspense>
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <Input
                    defaultValue={
                      overrides.withdrawnCommentDays ??
                      platformDefaults.withdrawnCommentDays
                    }
                    inputMode="numeric"
                    max={MAX_RETENTION_DAYS}
                    min={MIN_POLICY_VALUE}
                    name="withdrawn_comment_days"
                    step={1}
                    type="number"
                  />
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={overrides.contentEventDays === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.retention.content_event_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{ days: platformDefaults.contentEventDays }}
                />
              </Suspense>
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <Input
                    defaultValue={
                      overrides.contentEventDays ??
                      platformDefaults.contentEventDays
                    }
                    inputMode="numeric"
                    max={MAX_RETENTION_DAYS}
                    min={MIN_POLICY_VALUE}
                    name="content_event_days"
                    step={1}
                    type="number"
                  />
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={overrides.dailyRankingSnapshotDays === undefined}
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="admin.settings.policy.retention.daily_ranking_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{
                    days: platformDefaults.dailyRankingSnapshotDays,
                  }}
                />
              </Suspense>
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <Input
                    defaultValue={
                      overrides.dailyRankingSnapshotDays ??
                      platformDefaults.dailyRankingSnapshotDays
                    }
                    inputMode="numeric"
                    max={MAX_RETENTION_DAYS}
                    min={MIN_POLICY_VALUE}
                    name="daily_ranking_snapshot_days"
                    step={1}
                    type="number"
                  />
                </FieldContent>
              </Field>
            </PolicyOverrideValues>
          </PolicyOverrideGroup>

          <PolicyOverrideGroup
            initialUseDefault={
              overrides.weeklyRankingSnapshotDays === undefined
            }
          >
            <PolicyOverrideLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="admin.settings.policy.retention.weekly_ranking_legend" />
              </Suspense>
            </PolicyOverrideLegend>
            <PolicyOverrideUseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverrideUseDefault>
            <PolicyOverridePlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{
                    days: platformDefaults.weeklyRankingSnapshotDays,
                  }}
                />
              </Suspense>
            </PolicyOverridePlatformValue>
            <PolicyOverrideValues>
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <Input
                    defaultValue={
                      overrides.weeklyRankingSnapshotDays ??
                      platformDefaults.weeklyRankingSnapshotDays
                    }
                    inputMode="numeric"
                    max={MAX_RETENTION_DAYS}
                    min={MIN_POLICY_VALUE}
                    name="weekly_ranking_snapshot_days"
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
                <Message message="admin.settings.policy.retention.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ActionFormIdle>
                <Message message="admin.settings.policy.retention.submit" />
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
