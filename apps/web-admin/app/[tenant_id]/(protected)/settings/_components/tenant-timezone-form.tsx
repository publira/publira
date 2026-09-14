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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { listSupportedTimeZones } from "@publira/utils";
import { Suspense, useActionState, useMemo, useState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
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
  const t = useAdminMessages();
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
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.timezone.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.timezone.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-lg">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="timezone" type="hidden" value={timezone} />

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.timezone.label" />
            </Suspense>
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
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.settings.timezone.empty" />
                  </Suspense>
                </ComboboxEmpty>
                <ComboboxItems />
              </ComboboxPopup>
            </Combobox>
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.settings.timezone.field_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.admin_only" />
            </Suspense>
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
