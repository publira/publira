import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
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
import type { TenantCommentSettings } from "#lib/tenant-comment-settings";
import { MAX_TENANT_COMMENT_AUTO_HIDE_REPORT_THRESHOLD } from "#lib/tenant-comment-settings-shared";

import { updateTenantCommentSettingsAction } from "../_lib/actions";

interface TenantCommentSettingsFormProps {
  canEdit: boolean;
  /** The saved values, absent when the settings read failed. */
  initialSettings?: TenantCommentSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantCommentSettingsForm = ({
  canEdit,
  initialSettings,
  loadErrorMessage,
  tenantId,
}: TenantCommentSettingsFormProps) => {
  // Without the saved settings a save would overwrite the tenant's live policy
  // with whatever happened to be picked, so editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.comments.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.comments.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantCommentSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.comments.mode_label" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              {/* Off first, then the two ways of being on. */}
              <RadioGroup
                defaultValue={initialSettings?.commentMode}
                items={[
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-64" />}
                      >
                        <Message message="admin.settings.comments.mode_options.disabled.description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="admin.settings.comments.mode_options.disabled.label" />
                      </Suspense>
                    ),
                    value: "disabled",
                  },
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-64" />}
                      >
                        <Message message="admin.settings.comments.mode_options.immediate.description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="admin.settings.comments.mode_options.immediate.label" />
                      </Suspense>
                    ),
                    value: "immediate",
                  },
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-64" />}
                      >
                        <Message message="admin.settings.comments.mode_options.approval_required.description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="admin.settings.comments.mode_options.approval_required.label" />
                      </Suspense>
                    ),
                    value: "approval_required",
                  },
                ]}
                name="comment_mode"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.comments.auto_hide_label" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                className="sm:max-w-32"
                defaultValue={
                  initialSettings === undefined
                    ? ""
                    : String(initialSettings.autoHideReportThreshold)
                }
                inputMode="numeric"
                max={MAX_TENANT_COMMENT_AUTO_HIDE_REPORT_THRESHOLD}
                min={0}
                name="auto_hide_report_threshold"
                step={1}
                type="number"
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.comments.auto_hide_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>
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
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.settings.comments.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <ActionFormIdle>
                <Message message="admin.settings.comments.submit" />
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
