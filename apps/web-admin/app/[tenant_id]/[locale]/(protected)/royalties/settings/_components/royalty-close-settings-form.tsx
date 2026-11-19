import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { RoyaltyClosePolicy } from "#lib/royalty-period";

import { updateRoyaltyCloseSettingsAction } from "../_lib/actions";
import * as RoyaltyCloseMode from "./royalty-close-mode-fields";

interface RoyaltyCloseSettingsFormProps {
  canEdit: boolean;
  /** The saved policy, absent when the read failed. */
  initialPolicy?: RoyaltyClosePolicy;
  loadErrorMessage?: string;
  tenantId: string;
}

export const RoyaltyCloseSettingsForm = ({
  canEdit,
  initialPolicy,
  loadErrorMessage,
  tenantId,
}: RoyaltyCloseSettingsFormProps) => {
  // Saving after a failed read would replace the stored policy with whatever
  // happened to be picked, so editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.royalties.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.royalties.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateRoyaltyCloseSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          <RoyaltyCloseMode.Root initialPolicy={initialPolicy}>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.royalties.mode_label" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <RoyaltyCloseMode.RadioGroup
                  items={[
                    {
                      description: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-64" />}
                        >
                          <Message message="admin.settings.royalties.mode_options.manual.description" />
                        </Suspense>
                      ),
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.settings.royalties.mode_options.manual.label" />
                        </Suspense>
                      ),
                      value: "manual",
                    },
                    {
                      description: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-64" />}
                        >
                          <Message message="admin.settings.royalties.mode_options.automatic.description" />
                        </Suspense>
                      ),
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.settings.royalties.mode_options.automatic.label" />
                        </Suspense>
                      ),
                      value: "automatic",
                    },
                  ]}
                />
                <ActionForm.FieldError name="closeMode" />
              </Field.Content>
            </Field.Root>

            <RoyaltyCloseMode.AutoCloseDayField>
              <Field.Root>
                <Field.Label required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.settings.royalties.day_label" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <RoyaltyCloseMode.AutoCloseDaySelect />
                  <ActionForm.FieldError name="autoCloseDay" />
                  <Field.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.settings.royalties.day_description" />
                    </Suspense>
                  </Field.Description>
                </Field.Content>
              </Field.Root>
            </RoyaltyCloseMode.AutoCloseDayField>
          </RoyaltyCloseMode.Root>
        </ActionForm.Fieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.royalties.submit" />
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
