import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  MAX_RETENTION_DAYS,
  MIN_CONTENT_EVENT_DAYS,
  MIN_POLICY_VALUE,
} from "#lib/tenant-policy-shared";
import type {
  TenantRetentionOverrides,
  TenantRetentionPeriods,
} from "#lib/tenant-retention-settings";

import { updateTenantRetentionSettingsAction } from "../_lib/actions";
import * as PolicyOverride from "./policy-override-group";

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
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.policy.retention.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.policy.retention.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantRetentionSettingsAction}
        className="grid gap-4 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="revision" type="hidden" value={revision} />

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          <PolicyOverride.Root
            initialUseDefault={overrides.withdrawnCommentDays === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.retention.withdrawn_comment_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{
                    days: platformDefaults.withdrawnCommentDays,
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
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
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.contentEventDays === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.retention.content_event_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{ days: platformDefaults.contentEventDays }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={
                      overrides.contentEventDays ??
                      platformDefaults.contentEventDays
                    }
                    inputMode="numeric"
                    max={MAX_RETENTION_DAYS}
                    min={MIN_CONTENT_EVENT_DAYS}
                    name="content_event_days"
                    step={1}
                    type="number"
                  />
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={overrides.dailyRankingSnapshotDays === undefined}
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="admin.settings.policy.retention.daily_ranking_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{
                    days: platformDefaults.dailyRankingSnapshotDays,
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
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
                </Field.Content>
              </Field.Root>
            </PolicyOverride.Values>
          </PolicyOverride.Root>

          <PolicyOverride.Root
            initialUseDefault={
              overrides.weeklyRankingSnapshotDays === undefined
            }
          >
            <PolicyOverride.Legend>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="admin.settings.policy.retention.weekly_ranking_legend" />
              </Suspense>
            </PolicyOverride.Legend>
            <PolicyOverride.UseDefault>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.policy.use_platform_default" />
              </Suspense>
            </PolicyOverride.UseDefault>
            <PolicyOverride.PlatformValue>
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.settings.policy.retention.platform_days"
                  values={{
                    days: platformDefaults.weeklyRankingSnapshotDays,
                  }}
                />
              </Suspense>
            </PolicyOverride.PlatformValue>
            <PolicyOverride.Values>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.policy.retention.days_label" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
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
                <Message message="admin.settings.policy.retention.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.policy.retention.submit" />
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
