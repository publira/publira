import {
  ActionForm,
  ActionFormFieldError,
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
import type { RoyaltyClosePolicy } from "#lib/royalty-period";

import { updateRoyaltyCloseSettingsAction } from "../_lib/actions";
import {
  RoyaltyAutoCloseDayField,
  RoyaltyAutoCloseDaySelect,
  RoyaltyCloseModeRadioGroup,
  RoyaltyCloseModeScope,
} from "./royalty-close-mode-fields";

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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.royalties.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.royalties.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateRoyaltyCloseSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <RoyaltyCloseModeScope initialPolicy={initialPolicy}>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.royalties.mode_label" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <RoyaltyCloseModeRadioGroup
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
                <ActionFormFieldError name="closeMode" />
              </FieldContent>
            </Field>

            <RoyaltyAutoCloseDayField>
              <Field>
                <FieldLabel required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.settings.royalties.day_label" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <RoyaltyAutoCloseDaySelect />
                  <ActionFormFieldError name="autoCloseDay" />
                  <FieldDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.settings.royalties.day_description" />
                    </Suspense>
                  </FieldDescription>
                </FieldContent>
              </Field>
            </RoyaltyAutoCloseDayField>
          </RoyaltyCloseModeScope>
        </ActionFormFieldset>

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
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ActionFormIdle>
                <Message message="admin.settings.royalties.submit" />
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
