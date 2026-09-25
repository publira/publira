"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { useActionState, useState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import type { TenantCommentSettings } from "#lib/tenant-comment-settings";
import {
  isTenantCommentMode,
  MAX_TENANT_COMMENT_AUTO_HIDE_REPORT_THRESHOLD,
} from "#lib/tenant-comment-settings-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantCommentSettingsActionState } from "../settings-types";

interface TenantCommentSettingsFormProps {
  action: (
    prevState: TenantCommentSettingsActionState,
    formData: FormData
  ) => Promise<TenantCommentSettingsActionState>;
  canEdit: boolean;
  /** The saved values, absent when the settings read failed. */
  initialSettings?: TenantCommentSettings;
  loadErrorMessage?: string;
}

/**
 * The three modes in the order the card offers them: off, then the two ways of
 * being on.
 */
const commentModeItems = (disabled: boolean) => [
  {
    description: (
      <ClientMessage message="admin.settings.comments.mode_options.disabled.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.comments.mode_options.disabled.label" />
    ),
    value: "disabled",
  },
  {
    description: (
      <ClientMessage message="admin.settings.comments.mode_options.immediate.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.comments.mode_options.immediate.label" />
    ),
    value: "immediate",
  },
  {
    description: (
      <ClientMessage message="admin.settings.comments.mode_options.approval_required.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.comments.mode_options.approval_required.label" />
    ),
    value: "approval_required",
  },
];

export const TenantCommentSettingsForm = ({
  action,
  canEdit,
  initialSettings,
  loadErrorMessage,
}: TenantCommentSettingsFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [commentMode, setCommentMode] = useState(initialSettings?.commentMode);
  const [autoHideReportThreshold, setAutoHideReportThreshold] = useState(
    initialSettings === undefined
      ? ""
      : String(initialSettings.autoHideReportThreshold)
  );

  // A failed read leaves the card with no saved settings to show, so saving
  // from that state would overwrite the tenant's live policy with whatever
  // happened to be picked — turning commenting off for a tenant that had it on,
  // or removing comments at a threshold nobody chose. Editing stays closed
  // until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const fieldsDisabled = !canEdit || hasLoadError;

  // The controls close while the save is in flight as well. The Action carries
  // what the form held when it was submitted, so a change made in the meantime
  // would sit selected under "The comment settings were saved." while the
  // tenant is on the other one.
  const controlsDisabled = fieldsDisabled || isPending;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.comments.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.comments.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-lg">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="comment_mode" type="hidden" value={commentMode} />

        <Field>
          <FieldLabel htmlFor="tenant_comment_mode">
            <ClientMessage message="admin.settings.comments.mode_label" />
          </FieldLabel>
          <FieldContent>
            <RadioGroup
              id="tenant_comment_mode"
              items={commentModeItems(controlsDisabled)}
              onValueChange={(value) => {
                if (isTenantCommentMode(value)) {
                  setCommentMode(value);
                }
              }}
              value={commentMode}
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.comments.auto_hide_label" />
          </FieldLabel>
          <FieldContent>
            <Input
              className="sm:max-w-32"
              disabled={controlsDisabled}
              inputMode="numeric"
              max={MAX_TENANT_COMMENT_AUTO_HIDE_REPORT_THRESHOLD}
              min={0}
              name="auto_hide_report_threshold"
              onChange={(event) =>
                setAutoHideReportThreshold(event.target.value)
              }
              step={1}
              type="number"
              value={autoHideReportThreshold}
            />
            <FieldDescription>
              <ClientMessage message="admin.settings.comments.auto_hide_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <ClientMessage message="admin.settings.admin_only" />
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <ClientMessage message="admin.settings.comments.load_error_hint" />
            </span>
          </FormMessage>
        ) : null}

        {state ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={fieldsDisabled || isPending} type="submit">
            <ActionFormIdle>
              <ClientMessage message="admin.settings.comments.submit" />
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
