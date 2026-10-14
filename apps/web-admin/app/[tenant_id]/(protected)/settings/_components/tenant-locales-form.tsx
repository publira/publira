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
import type { TenantLocales } from "#lib/tenant-locales";

import { updateTenantLocalesAction } from "../_lib/actions";
import { TenantLocalesFields } from "./tenant-locales-fields";

interface TenantLocalesFormProps {
  canEdit: boolean;
  /** The saved values, absent when the settings read failed. */
  initialLocales?: TenantLocales;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantLocalesForm = ({
  canEdit,
  initialLocales,
  loadErrorMessage,
  tenantId,
}: TenantLocalesFormProps) => {
  // A failed read would save a stand-in over the real languages, so editing
  // stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.locales.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.locales.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantLocalesAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <TenantLocalesFields
            initialDefaultLocale={initialLocales?.defaultLocale}
            initialSupportedLocales={initialLocales?.supportedLocales}
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
                <Message message="admin.settings.locales.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <ActionFormIdle>
                <Message message="admin.settings.locales.submit" />
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
