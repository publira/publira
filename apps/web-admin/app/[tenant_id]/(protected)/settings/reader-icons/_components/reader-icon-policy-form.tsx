import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
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
import type { TenantReaderIconPolicy } from "#lib/reader-icon-settings-shared";

import { updateReaderIconPolicyAction } from "../_lib/actions";
import {
  ReaderIconPolicyRadioGroup,
  ReaderIconPolicySelection,
  ReaderIconPolicyWhenClearing,
} from "./reader-icon-policy-selection";

const FORM_ID = "reader-icon-policy-form";

interface ReaderIconPolicyFormProps {
  canEdit: boolean;
  /** The saved policy, absent when the read failed. */
  initialPolicy?: TenantReaderIconPolicy;
  loadErrorMessage?: string;
  tenantId: string;
}

/**
 * Chooses what readers may show as an icon. Saving `preset` or `disabled` may
 * take icons down, so its save button asks first and says which icons go;
 * `upload` saves straight away.
 */
export const ReaderIconPolicyForm = ({
  canEdit,
  initialPolicy,
  loadErrorMessage,
  tenantId,
}: ReaderIconPolicyFormProps) => {
  // Without the saved policy a save would replace the tenant's choice with
  // whatever happened to be picked, and a narrower one clears icons, so
  // editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);
  const submitLabel = (
    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
      <ActionFormIdle>
        <Message message="admin.settings.reader_icons.policy.submit" />
      </ActionFormIdle>
      <ActionFormPending>
        <Message message="admin.settings.saving" />
      </ActionFormPending>
    </Suspense>
  );

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.reader_icons.policy.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.reader_icons.policy.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateReaderIconPolicyAction}
        className="grid gap-4 sm:max-w-lg"
        id={FORM_ID}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ReaderIconPolicySelection key={initialPolicy} saved={initialPolicy}>
          <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.reader_icons.policy.label" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                {/* From the widest choice to the narrowest. */}
                <ReaderIconPolicyRadioGroup
                  items={[
                    {
                      description: (
                        <Suspense
                          fallback={<SkeletonLine className="h-3 w-64" />}
                        >
                          <Message message="admin.settings.reader_icons.policy.options.upload.description" />
                        </Suspense>
                      ),
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.reader_icons.policy.options.upload.label" />
                        </Suspense>
                      ),
                      value: "upload",
                    },
                    {
                      description: (
                        <Suspense
                          fallback={<SkeletonLine className="h-3 w-64" />}
                        >
                          <Message message="admin.settings.reader_icons.policy.options.preset.description" />
                        </Suspense>
                      ),
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.reader_icons.policy.options.preset.label" />
                        </Suspense>
                      ),
                      value: "preset",
                    },
                    {
                      description: (
                        <Suspense
                          fallback={<SkeletonLine className="h-3 w-64" />}
                        >
                          <Message message="admin.settings.reader_icons.policy.options.disabled.description" />
                        </Suspense>
                      ),
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.reader_icons.policy.options.disabled.label" />
                        </Suspense>
                      ),
                      value: "disabled",
                    },
                  ]}
                  name="reader_icon_policy"
                />
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
                  <Message message="admin.settings.reader_icons.policy.load_error_hint" />
                </Suspense>
              </span>
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <ReaderIconPolicyWhenClearing clearance="none">
              <ActionFormSubmit disabled={fieldsDisabled}>
                {submitLabel}
              </ActionFormSubmit>
            </ReaderIconPolicyWhenClearing>

            <ReaderIconPolicyWhenClearing clearance="uploads">
              <ConfirmDialog>
                <ConfirmDialogTrigger
                  disabled={fieldsDisabled}
                  render={<Button type="button" />}
                >
                  {submitLabel}
                </ConfirmDialogTrigger>
                <ConfirmDialogContent>
                  <ConfirmDialogHeader>
                    <ConfirmDialogTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_title" />
                      </Suspense>
                    </ConfirmDialogTitle>
                    <ConfirmDialogDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_clears_uploads" />
                      </Suspense>
                    </ConfirmDialogDescription>
                  </ConfirmDialogHeader>
                  <ConfirmDialogFooter>
                    <ConfirmDialogCancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </ConfirmDialogCancel>
                    <ConfirmDialogAction form={FORM_ID}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_action" />
                      </Suspense>
                    </ConfirmDialogAction>
                  </ConfirmDialogFooter>
                </ConfirmDialogContent>
              </ConfirmDialog>
            </ReaderIconPolicyWhenClearing>

            <ReaderIconPolicyWhenClearing clearance="all">
              <ConfirmDialog>
                <ConfirmDialogTrigger
                  disabled={fieldsDisabled}
                  render={<Button type="button" />}
                >
                  {submitLabel}
                </ConfirmDialogTrigger>
                <ConfirmDialogContent>
                  <ConfirmDialogHeader>
                    <ConfirmDialogTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_title" />
                      </Suspense>
                    </ConfirmDialogTitle>
                    <ConfirmDialogDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_clears_all" />
                      </Suspense>
                    </ConfirmDialogDescription>
                  </ConfirmDialogHeader>
                  <ConfirmDialogFooter>
                    <ConfirmDialogCancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </ConfirmDialogCancel>
                    <ConfirmDialogAction form={FORM_ID}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_action" />
                      </Suspense>
                    </ConfirmDialogAction>
                  </ConfirmDialogFooter>
                </ConfirmDialogContent>
              </ConfirmDialog>
            </ReaderIconPolicyWhenClearing>
          </div>
        </ReaderIconPolicySelection>
      </ActionForm>
    </AdminSection>
  );
};
