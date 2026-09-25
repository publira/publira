"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import {
  MAX_RETENTION_DAYS,
  MIN_POLICY_VALUE,
} from "#lib/tenant-policy-shared";
import type {
  TenantRetentionOverrides,
  TenantRetentionPeriods,
} from "#lib/tenant-retention-settings";
import { useTenantId } from "#lib/use-tenant-id";

import { PolicyOverrideGroup } from "./policy-override-group";

interface TenantRetentionSettingsFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  canEdit: boolean;
  loadErrorMessage?: string;
  /** The periods every absent override follows, from the platform settings. */
  platformDefaults: TenantRetentionPeriods;
  overrides: TenantRetentionOverrides;
  /** The stored row's version, sent back so a stale save is refused. */
  revision: string;
}

type RetentionPeriodKey = keyof TenantRetentionPeriods;

interface PeriodField {
  useDefault: boolean;
  value: string;
}

/** An unsaved period starts on the platform default, so unticking opens a value to adjust. */
const toPeriodField = (
  override: number | undefined,
  platformDefault: number
): PeriodField => ({
  useDefault: override === undefined,
  value: String(override ?? platformDefault),
});

export const TenantRetentionSettingsForm = ({
  action,
  canEdit,
  loadErrorMessage,
  overrides,
  platformDefaults,
  revision,
}: TenantRetentionSettingsFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [periods, setPeriods] = useState<
    Record<RetentionPeriodKey, PeriodField>
  >(() => ({
    contentEventDays: toPeriodField(
      overrides.contentEventDays,
      platformDefaults.contentEventDays
    ),
    dailyRankingSnapshotDays: toPeriodField(
      overrides.dailyRankingSnapshotDays,
      platformDefaults.dailyRankingSnapshotDays
    ),
    weeklyRankingSnapshotDays: toPeriodField(
      overrides.weeklyRankingSnapshotDays,
      platformDefaults.weeklyRankingSnapshotDays
    ),
    withdrawnCommentDays: toPeriodField(
      overrides.withdrawnCommentDays,
      platformDefaults.withdrawnCommentDays
    ),
  }));

  const update = (key: RetentionPeriodKey, patch: Partial<PeriodField>) => {
    setPeriods((previous) => ({
      ...previous,
      [key]: { ...previous[key], ...patch },
    }));
  };

  // A failed read has no stored periods, so a save from here would write values
  // nobody chose. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const fieldsDisabled = !canEdit || hasLoadError;
  const controlsDisabled = fieldsDisabled || isPending;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.policy.retention.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.policy.retention.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-3xl">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="revision" type="hidden" value={revision} />

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.retention.withdrawn_comment_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("withdrawnCommentDays", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.retention.platform_days"
              values={{ days: String(platformDefaults.withdrawnCommentDays) }}
            />
          }
          useDefault={periods.withdrawnCommentDays.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.retention.days_label" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || periods.withdrawnCommentDays.useDefault
                }
                inputMode="numeric"
                max={MAX_RETENTION_DAYS}
                min={MIN_POLICY_VALUE}
                name="withdrawn_comment_days"
                onChange={(event) =>
                  update("withdrawnCommentDays", { value: event.target.value })
                }
                step={1}
                type="number"
                value={periods.withdrawnCommentDays.value}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.retention.content_event_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("contentEventDays", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.retention.platform_days"
              values={{ days: String(platformDefaults.contentEventDays) }}
            />
          }
          useDefault={periods.contentEventDays.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.retention.days_label" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled || periods.contentEventDays.useDefault
                }
                inputMode="numeric"
                max={MAX_RETENTION_DAYS}
                min={MIN_POLICY_VALUE}
                name="content_event_days"
                onChange={(event) =>
                  update("contentEventDays", { value: event.target.value })
                }
                step={1}
                type="number"
                value={periods.contentEventDays.value}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.retention.daily_ranking_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("dailyRankingSnapshotDays", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.retention.platform_days"
              values={{
                days: String(platformDefaults.dailyRankingSnapshotDays),
              }}
            />
          }
          useDefault={periods.dailyRankingSnapshotDays.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.retention.days_label" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled ||
                  periods.dailyRankingSnapshotDays.useDefault
                }
                inputMode="numeric"
                max={MAX_RETENTION_DAYS}
                min={MIN_POLICY_VALUE}
                name="daily_ranking_snapshot_days"
                onChange={(event) =>
                  update("dailyRankingSnapshotDays", {
                    value: event.target.value,
                  })
                }
                step={1}
                type="number"
                value={periods.dailyRankingSnapshotDays.value}
              />
            </FieldContent>
          </Field>
        </PolicyOverrideGroup>

        <PolicyOverrideGroup
          disabled={controlsDisabled}
          legend={
            <ClientMessage message="admin.settings.policy.retention.weekly_ranking_legend" />
          }
          onUseDefaultChange={(useDefault) =>
            update("weeklyRankingSnapshotDays", { useDefault })
          }
          platformValue={
            <ClientMessage
              message="admin.settings.policy.retention.platform_days"
              values={{
                days: String(platformDefaults.weeklyRankingSnapshotDays),
              }}
            />
          }
          useDefault={periods.weeklyRankingSnapshotDays.useDefault}
        >
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.settings.policy.retention.days_label" />
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={
                  controlsDisabled ||
                  periods.weeklyRankingSnapshotDays.useDefault
                }
                inputMode="numeric"
                max={MAX_RETENTION_DAYS}
                min={MIN_POLICY_VALUE}
                name="weekly_ranking_snapshot_days"
                onChange={(event) =>
                  update("weeklyRankingSnapshotDays", {
                    value: event.target.value,
                  })
                }
                step={1}
                type="number"
                value={periods.weeklyRankingSnapshotDays.value}
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
              <ClientMessage message="admin.settings.policy.retention.load_error_hint" />
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
            <ActionFormIdle>
              <ClientMessage message="admin.settings.policy.retention.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.settings.saving" />
            </ActionFormPending>
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
