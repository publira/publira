"use client";

import { Button } from "@publira/ui-components/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { listSupportedTimeZones } from "@publira/utils";
import { useActionState, useMemo, useState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
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
  const t = useClientMessages();
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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.timezone.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.timezone.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-lg">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="timezone" type="hidden" value={timezone} />

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.timezone.label" />
          </FieldLabel>
          <FieldContent>
            <Combobox
              disabled={!canEdit}
              items={items}
              onValueChange={setTimezone}
              value={timezone}
            >
              <ComboboxInput
                placeholder={t("admin.settings.timezone.placeholder")}
              />
              <ComboboxPopup>
                <ComboboxEmpty>
                  <ClientMessage message="admin.settings.timezone.empty" />
                </ComboboxEmpty>
                <ComboboxItems />
              </ComboboxPopup>
            </Combobox>
            <FieldDescription>
              <ClientMessage message="admin.settings.timezone.field_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <ClientMessage message="admin.settings.admin_only" />
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
              ? t("admin.settings.saving")
              : t("admin.settings.timezone.submit")}
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
