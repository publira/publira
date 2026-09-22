"use client";

import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { useActionState, useCallback, useId, useState } from "react";
import type { ChangeEvent } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import { isSurfaceAvailabilityValue } from "#lib/surface-availability";
import type { TenantPurchaseSettings } from "#lib/tenant-purchase-settings";
import { useTenantId } from "#lib/use-tenant-id";

import type {
  TenantPurchaseSettingsFieldErrors,
  TenantPurchaseSettingsFormState,
} from "../payment-types";

const PURCHASE_AVAILABILITY_ITEMS = [
  {
    label: <ClientMessage message="admin.settings.purchase.options.all" />,
    value: "all",
  },
  {
    label: <ClientMessage message="admin.settings.purchase.options.web" />,
    value: "web",
  },
  {
    label: <ClientMessage message="admin.settings.purchase.options.app" />,
    value: "app",
  },
];

const SubmitLabel = ({ isPending }: { isPending: boolean }) =>
  isPending ? (
    <ClientMessage message="admin.settings.saving" />
  ) : (
    <ClientMessage message="admin.settings.purchase.submit" />
  );

interface PurchaseSettingsFieldsProps {
  disabled: boolean;
  fieldErrors?: TenantPurchaseSettingsFieldErrors;
  initialSettings: TenantPurchaseSettings;
}

/**
 * Seeded once per mount: the form keys these by the saved settings, so a save
 * that the API normalized remounts them on what it stored. The addresses are
 * held in state because React resets an uncontrolled field once the Action
 * settles, which would wipe the address a refused save is asking to fix.
 */
const PurchaseSettingsFields = ({
  disabled,
  fieldErrors,
  initialSettings,
}: PurchaseSettingsFieldsProps) => {
  const [purchaseAvailability, setPurchaseAvailability] = useState(
    () => initialSettings.purchaseAvailability
  );
  const [appStoreUrl, setAppStoreUrl] = useState(
    () => initialSettings.appStoreUrl
  );
  const [googlePlayUrl, setGooglePlayUrl] = useState(
    () => initialSettings.googlePlayUrl
  );
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleAppStoreUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setAppStoreUrl(event.target.value);
    },
    []
  );

  const handleGooglePlayUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setGooglePlayUrl(event.target.value);
    },
    []
  );

  const handleValueChange = useCallback((next: string) => {
    if (isSurfaceAvailabilityValue(next)) {
      setPurchaseAvailability(next);
    }
  }, []);

  return (
    <>
      <Field>
        <FieldLabel htmlFor={selectId}>
          <ClientMessage message="admin.settings.purchase.availability" />
        </FieldLabel>
        <FieldContent>
          <Select
            disabled={disabled}
            id={selectId}
            items={PURCHASE_AVAILABILITY_ITEMS}
            onValueChange={handleValueChange}
            value={purchaseAvailability}
          />
          <input
            name="purchase_availability"
            type="hidden"
            value={purchaseAvailability}
          />
          <FieldDescription>
            <ClientMessage message="admin.settings.purchase.availability_description" />
          </FieldDescription>
          {fieldErrors?.purchaseAvailability ? (
            <FormMessage variant="destructive">
              {fieldErrors.purchaseAvailability}
            </FormMessage>
          ) : null}
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>
          <ClientMessage message="admin.settings.purchase.app_store_url" />
        </FieldLabel>
        <FieldContent>
          <Input
            disabled={disabled}
            inputMode="url"
            name="app_store_url"
            onChange={handleAppStoreUrlChange}
            placeholder="https://apps.apple.com/app/id…"
            type="text"
            value={appStoreUrl}
          />
          {fieldErrors?.appStoreUrl ? (
            <FormMessage variant="destructive">
              {fieldErrors.appStoreUrl}
            </FormMessage>
          ) : null}
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>
          <ClientMessage message="admin.settings.purchase.google_play_url" />
        </FieldLabel>
        <FieldContent>
          <Input
            disabled={disabled}
            inputMode="url"
            name="google_play_url"
            onChange={handleGooglePlayUrlChange}
            placeholder="https://play.google.com/store/apps/details?id=…"
            type="text"
            value={googlePlayUrl}
          />
          <FieldDescription>
            <ClientMessage message="admin.settings.purchase.store_url_description" />
          </FieldDescription>
          {fieldErrors?.googlePlayUrl ? (
            <FormMessage variant="destructive">
              {fieldErrors.googlePlayUrl}
            </FormMessage>
          ) : null}
        </FieldContent>
      </Field>
    </>
  );
};

interface TenantPurchaseSettingsFormProps {
  action: (
    prevState: TenantPurchaseSettingsFormState,
    formData: FormData
  ) => Promise<TenantPurchaseSettingsFormState>;
  canEdit: boolean;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantPurchaseSettings;
  loadErrorMessage?: string;
}

export const TenantPurchaseSettingsForm = ({
  action,
  canEdit,
  initialSettings,
  loadErrorMessage,
}: TenantPurchaseSettingsFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const settings = state?.ok ? state.settings : initialSettings;

  // A failed read leaves nothing to seed the fields with, and a save from that
  // state would write whatever they happened to hold over the stored default.
  const fieldsDisabled = !canEdit || settings === undefined || isPending;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.purchase.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.purchase.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-5 sm:max-w-3xl">
        <input name="tenant_id" type="hidden" value={tenantId} />

        {settings === undefined ? null : (
          <PurchaseSettingsFields
            disabled={fieldsDisabled}
            fieldErrors={state?.ok ? undefined : state?.fieldErrors}
            key={[
              settings.purchaseAvailability,
              settings.appStoreUrl,
              settings.googlePlayUrl,
            ].join("\n")}
            initialSettings={settings}
          />
        )}

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

        <div className="flex flex-wrap gap-3">
          <Button disabled={fieldsDisabled} type="submit">
            <SubmitLabel isPending={isPending} />
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
