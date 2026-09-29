import { getLocaleLabel, getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
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
import { Select } from "@publira/ui-components/select";
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

import { updateTenantDefaultLocaleAction } from "../_lib/actions";

interface TenantDefaultLocaleFormProps {
  canEdit: boolean;
  /** The saved value, absent when the settings read failed. */
  initialDefaultLocale?: Locale;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantDefaultLocaleForm = ({
  canEdit,
  initialDefaultLocale,
  loadErrorMessage,
  tenantId,
}: TenantDefaultLocaleFormProps) => {
  // A failed read would save a stand-in over the real default, so editing
  // stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.default_locale.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.default_locale.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantDefaultLocaleAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset disabled={fieldsDisabled}>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.default_locale.label" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              {/* Autonyms read the same in every console language. */}
              <Select
                defaultValue={initialDefaultLocale}
                items={getLocales().map((locale) => ({
                  label: getLocaleLabel(locale),
                  value: locale,
                }))}
                name="default_locale"
                placeholder={
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.default_locale.placeholder" />
                  </Suspense>
                }
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.default_locale.field_description" />
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
                <Message message="admin.settings.default_locale.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <ActionFormIdle>
                <Message message="admin.settings.default_locale.submit" />
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
