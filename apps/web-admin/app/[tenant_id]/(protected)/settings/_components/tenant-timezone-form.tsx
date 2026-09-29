import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  ComboboxEmpty,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
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

import { updateTenantTimezoneAction } from "../_lib/actions";
import { TenantTimezoneCombobox } from "./tenant-timezone-combobox";

interface TenantTimezoneFormProps {
  canEdit: boolean;
  initialTimezone: string;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantTimezoneForm = ({
  canEdit,
  initialTimezone,
  loadErrorMessage,
  tenantId,
}: TenantTimezoneFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="admin.settings.timezone.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.timezone.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    <ActionForm
      action={updateTenantTimezoneAction}
      className="grid gap-4 sm:max-w-lg"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionFormFieldset>
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.settings.timezone.label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <TenantTimezoneCombobox
              disabled={!canEdit}
              initialTimezone={initialTimezone}
            >
              <ComboboxPopup>
                <ComboboxEmpty>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.timezone.empty" />
                  </Suspense>
                </ComboboxEmpty>
                <ComboboxItems />
              </ComboboxPopup>
            </TenantTimezoneCombobox>
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.timezone.field_description" />
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
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit disabled={!canEdit}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ActionFormIdle>
              <Message message="admin.settings.timezone.submit" />
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
