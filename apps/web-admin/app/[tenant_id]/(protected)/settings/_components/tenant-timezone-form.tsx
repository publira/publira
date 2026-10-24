import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

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
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="admin.settings.timezone.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.timezone.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root
      action={updateTenantTimezoneAction}
      className="grid gap-4 sm:max-w-lg"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionForm.Fieldset>
        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.settings.timezone.label" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <TenantTimezoneCombobox
              disabled={!canEdit}
              initialTimezone={initialTimezone}
            >
              <Combobox.Popup>
                <Combobox.Empty>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.settings.timezone.empty" />
                  </Suspense>
                </Combobox.Empty>
                <Combobox.Items />
              </Combobox.Popup>
            </TenantTimezoneCombobox>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.timezone.field_description" />
              </Suspense>
            </Field.Description>
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
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit disabled={!canEdit}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ActionForm.Idle>
              <Message message="admin.settings.timezone.submit" />
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
