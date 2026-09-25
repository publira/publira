"use client";

import { isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Select } from "@publira/ui-components/select";
import { useActionState, useContext, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantDefaultLocaleActionState } from "../settings-types";

export interface TenantDefaultLocaleFormOption {
  label: string;
  locale: Locale;
}

interface TenantDefaultLocaleFormProps {
  action: (
    prevState: TenantDefaultLocaleActionState,
    formData: FormData
  ) => Promise<TenantDefaultLocaleActionState>;
  canEdit: boolean;
  /** The saved value, absent when the settings read failed. */
  initialDefaultLocale?: Locale;
  loadErrorMessage?: string;
  options: readonly TenantDefaultLocaleFormOption[];
}

export const TenantDefaultLocaleForm = ({
  action,
  canEdit,
  initialDefaultLocale,
  loadErrorMessage,
  options,
}: TenantDefaultLocaleFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [defaultLocale, setDefaultLocale] = useState(initialDefaultLocale);

  // A failed read hands the form the app's fallback locale as a stand-in, not
  // the stored value, so saving from that state would overwrite the real
  // default with it. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const fieldsDisabled = !canEdit || hasLoadError;
  // The save carries the locale picked when it was submitted, so the picker
  // stays closed until it lands.
  const controlsDisabled = fieldsDisabled || isPending;

  const items = options.map((option) => ({
    label: option.label,
    value: option.locale,
  }));

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.default_locale.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.default_locale.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-lg">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="default_locale" type="hidden" value={defaultLocale} />

        <Field>
          <FieldLabel htmlFor="tenant_default_locale">
            <ClientMessage message="admin.settings.default_locale.label" />
          </FieldLabel>
          <FieldContent>
            <Select
              disabled={controlsDisabled}
              id="tenant_default_locale"
              items={items}
              onValueChange={(value) => {
                if (isLocale(value)) {
                  setDefaultLocale(value);
                }
              }}
              placeholder={t("admin.settings.default_locale.placeholder")}
              value={defaultLocale}
            />
            <FieldDescription>
              <ClientMessage message="admin.settings.default_locale.field_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <ClientMessage message="admin.settings.admin_only" />
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <ClientMessage message="admin.settings.default_locale.load_error_hint" />
            </span>
          </FormMessage>
        ) : null}

        {state ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={controlsDisabled} type="submit">
            <ActionFormIdle>
              <ClientMessage message="admin.settings.default_locale.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.settings.saving" />
            </ActionFormPending>
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
