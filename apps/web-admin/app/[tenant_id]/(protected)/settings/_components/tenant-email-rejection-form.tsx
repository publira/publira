import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
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
import type { TenantEmailRejectionSettings } from "#lib/tenant-email-rejection-settings";

import { updateTenantEmailRejectionAction } from "../_lib/actions";
import { TenantEmailRejectionFields } from "./tenant-email-rejection-fields";

interface TenantEmailRejectionFormProps {
  canEdit: boolean;
  /**
   * Whether the platform policy names a disposable-domain list, absent when
   * the setting was not read.
   */
  disposableDomainListAvailable?: boolean;
  /**
   * The saved setting, absent when it was not read: on a failed read, and for
   * anyone but a tenant administrator, whom the API does not answer.
   */
  initialSettings?: TenantEmailRejectionSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantEmailRejectionForm = ({
  canEdit,
  disposableDomainListAvailable,
  initialSettings,
  loadErrorMessage,
  tenantId,
}: TenantEmailRejectionFormProps) => {
  // A save replaces the whole list, so without the saved one it would empty
  // the tenant's list; editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || initialSettings === undefined;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.email_rejection.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.email_rejection.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantEmailRejectionAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <TenantEmailRejectionFields
            disposableDomainListAvailable={disposableDomainListAvailable}
            initialSettings={initialSettings}
          />
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
                <Message message="admin.settings.email_rejection.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionFormIdle>
                <Message message="admin.settings.email_rejection.submit" />
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
