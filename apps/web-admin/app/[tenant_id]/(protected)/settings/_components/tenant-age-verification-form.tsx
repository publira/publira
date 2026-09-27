import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
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
import type { TenantAgeVerification } from "#lib/tenant-age-verification-shared";

import { updateTenantAgeVerificationAction } from "../_lib/actions";

interface TenantAgeVerificationFormProps {
  canEdit: boolean;
  /** The saved rule, absent when the read failed. */
  initialAgeVerification?: TenantAgeVerification;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantAgeVerificationForm = ({
  canEdit,
  initialAgeVerification,
  loadErrorMessage,
  tenantId,
}: TenantAgeVerificationFormProps) => {
  // Without the saved rule a save would overwrite the tenant's live policy with
  // whatever happened to be picked, so editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.age_verification.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.age_verification.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantAgeVerificationAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset disabled={fieldsDisabled}>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.age_verification.label" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              {/* The rungs in ladder order: nothing proven, then r18, then both ratings. */}
              <RadioGroup
                defaultValue={initialAgeVerification}
                items={[
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-64" />}
                      >
                        <Message message="admin.settings.age_verification.options.none.description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="admin.settings.age_verification.options.none.label" />
                      </Suspense>
                    ),
                    value: "none",
                  },
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-64" />}
                      >
                        <Message message="admin.settings.age_verification.options.r18.description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="admin.settings.age_verification.options.r18.label" />
                      </Suspense>
                    ),
                    value: "r18",
                  },
                  {
                    description: (
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-64" />}
                      >
                        <Message message="admin.settings.age_verification.options.r15_and_r18.description" />
                      </Suspense>
                    ),
                    label: (
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="admin.settings.age_verification.options.r15_and_r18.label" />
                      </Suspense>
                    ),
                    value: "r15_and_r18",
                  },
                ]}
                name="age_verification"
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
                <Message message="admin.settings.age_verification.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <ActionFormIdle>
                <Message message="admin.settings.age_verification.submit" />
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
