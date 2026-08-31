"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Combobox } from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { listSupportedTimeZones } from "@publira/utils";
import { useActionState, useContext, useMemo, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantTimezoneActionState } from "../settings-types";

interface TenantTimezoneFormProps {
  action: (
    prevState: TenantTimezoneActionState,
    formData: FormData
  ) => Promise<TenantTimezoneActionState>;
  canEdit: boolean;
  initialTimezone: string;
  loadErrorMessage?: string;
}

export const TenantTimezoneForm = ({
  action,
  canEdit,
  initialTimezone,
  loadErrorMessage,
}: TenantTimezoneFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [timezone, setTimezone] = useState(initialTimezone);

  const items = useMemo<ComboboxItem[]>(() => {
    const zones = listSupportedTimeZones();
    // A stored alias (`Asia/Calcutta`) is valid but is not always enumerated by
    // the runtime's ICU build, so keep it selectable instead of dropping it.
    const values =
      !initialTimezone || zones.includes(initialTimezone)
        ? zones
        : [initialTimezone, ...zones];

    return values.map((zone) => ({ label: zone, value: zone }));
  }, [initialTimezone]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.timezone.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.timezone.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="timezone" type="hidden" value={timezone} />

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.timezone.label")}
            </FieldLabel>
            <FieldContent>
              <Combobox
                disabled={!canEdit}
                emptyMessage={getMessage(
                  messages,
                  "admin.settings.timezone.empty"
                )}
                items={items}
                onValueChange={setTimezone}
                placeholder={getMessage(
                  messages,
                  "admin.settings.timezone.placeholder"
                )}
                value={timezone}
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.settings.timezone.field_description"
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
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={!canEdit || isPending} type="submit">
              {isPending
                ? getMessage(messages, "admin.settings.saving")
                : getMessage(messages, "admin.settings.timezone.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
