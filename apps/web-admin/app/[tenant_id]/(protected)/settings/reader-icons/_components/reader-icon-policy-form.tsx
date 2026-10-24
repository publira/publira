import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantReaderIconPolicy } from "#lib/reader-icon-settings-shared";

import { updateReaderIconPolicyAction } from "../_lib/actions";
import * as ReaderIconPolicySelection from "./reader-icon-policy-selection";

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
      <ActionForm.Idle>
        <Message message="admin.settings.reader_icons.policy.submit" />
      </ActionForm.Idle>
      <ActionForm.Pending>
        <Message message="admin.settings.saving" />
      </ActionForm.Pending>
    </Suspense>
  );

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.reader_icons.policy.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.reader_icons.policy.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateReaderIconPolicyAction}
        className="grid gap-4 sm:max-w-lg"
        id={FORM_ID}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ReaderIconPolicySelection.Root
          key={initialPolicy}
          saved={initialPolicy}
        >
          <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.reader_icons.policy.label" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                {/* From the widest choice to the narrowest. */}
                <ReaderIconPolicySelection.RadioGroup
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
              </Field.Content>
            </Field.Root>
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
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.reader_icons.policy.load_error_hint" />
                </Suspense>
              </span>
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <ReaderIconPolicySelection.WhenClearing clearance="none">
              <ActionForm.Submit disabled={fieldsDisabled}>
                {submitLabel}
              </ActionForm.Submit>
            </ReaderIconPolicySelection.WhenClearing>

            <ReaderIconPolicySelection.WhenClearing clearance="uploads">
              <ConfirmDialog.Root>
                <ConfirmDialog.Trigger
                  disabled={fieldsDisabled}
                  render={<Button type="button" />}
                >
                  {submitLabel}
                </ConfirmDialog.Trigger>
                <ConfirmDialog.Content>
                  <ConfirmDialog.Header>
                    <ConfirmDialog.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_title" />
                      </Suspense>
                    </ConfirmDialog.Title>
                    <ConfirmDialog.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_clears_uploads" />
                      </Suspense>
                    </ConfirmDialog.Description>
                  </ConfirmDialog.Header>
                  <ConfirmDialog.Footer>
                    <ConfirmDialog.Cancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </ConfirmDialog.Cancel>
                    <ConfirmDialog.Action form={FORM_ID}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_action" />
                      </Suspense>
                    </ConfirmDialog.Action>
                  </ConfirmDialog.Footer>
                </ConfirmDialog.Content>
              </ConfirmDialog.Root>
            </ReaderIconPolicySelection.WhenClearing>

            <ReaderIconPolicySelection.WhenClearing clearance="all">
              <ConfirmDialog.Root>
                <ConfirmDialog.Trigger
                  disabled={fieldsDisabled}
                  render={<Button type="button" />}
                >
                  {submitLabel}
                </ConfirmDialog.Trigger>
                <ConfirmDialog.Content>
                  <ConfirmDialog.Header>
                    <ConfirmDialog.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_title" />
                      </Suspense>
                    </ConfirmDialog.Title>
                    <ConfirmDialog.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_clears_all" />
                      </Suspense>
                    </ConfirmDialog.Description>
                  </ConfirmDialog.Header>
                  <ConfirmDialog.Footer>
                    <ConfirmDialog.Cancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </ConfirmDialog.Cancel>
                    <ConfirmDialog.Action form={FORM_ID}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.settings.reader_icons.policy.confirm_action" />
                      </Suspense>
                    </ConfirmDialog.Action>
                  </ConfirmDialog.Footer>
                </ConfirmDialog.Content>
              </ConfirmDialog.Root>
            </ReaderIconPolicySelection.WhenClearing>
          </div>
        </ReaderIconPolicySelection.Root>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
