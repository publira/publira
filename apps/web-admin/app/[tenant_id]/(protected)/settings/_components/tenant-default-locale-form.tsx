"use client";

import { getMessage, isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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
  initialDefaultLocale: Locale;
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
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [defaultLocale, setDefaultLocale] = useState(initialDefaultLocale);

  // A failed read hands the form the app's fallback locale as a stand-in, not
  // the stored value, so saving from that state would overwrite the real
  // default with it. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const fieldsDisabled = !canEdit || hasLoadError;

  const items = options.map((option) => ({
    label: option.label,
    value: option.locale,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.default_locale.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.default_locale.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="default_locale" type="hidden" value={defaultLocale} />

          <Field>
            <FieldLabel htmlFor="tenant_default_locale">
              {getMessage(messages, "admin.settings.default_locale.label")}
            </FieldLabel>
            <FieldContent>
              <Select
                disabled={fieldsDisabled}
                id="tenant_default_locale"
                items={items}
                onValueChange={(value) => {
                  if (isLocale(value)) {
                    setDefaultLocale(value);
                  }
                }}
                placeholder={getMessage(
                  messages,
                  "admin.settings.default_locale.placeholder"
                )}
                value={defaultLocale}
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.settings.default_locale.field_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          {canEdit ? null : (
            <FormMessage variant="destructive">
              {getMessage(messages, "admin.settings.admin_only")}
            </FormMessage>
          )}

          {loadErrorMessage ? (
            <FormMessage variant="destructive">
              <span className="block">{loadErrorMessage}</span>
              <span className="block">
                {getMessage(
                  messages,
                  "admin.settings.default_locale.load_error_hint"
                )}
              </span>
            </FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={fieldsDisabled || isPending} type="submit">
              {isPending
                ? getMessage(messages, "admin.settings.saving")
                : getMessage(messages, "admin.settings.default_locale.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
