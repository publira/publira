"use client";

import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { Select } from "@publira/ui-components/select";
import { useActionState, useId, useState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  isRoyaltyCloseMode,
  MAX_ROYALTY_AUTO_CLOSE_DAY,
} from "#lib/royalty-period";
import type { RoyaltyClosePolicy } from "#lib/royalty-period";
import { useTenantId } from "#lib/use-tenant-id";

import type { RoyaltyCloseSettingsFormState } from "../../royalty-types";

interface RoyaltyCloseSettingsFormProps {
  action: (
    prevState: RoyaltyCloseSettingsFormState,
    formData: FormData
  ) => Promise<RoyaltyCloseSettingsFormState>;
  canEdit: boolean;
  /** The saved policy, absent when the read failed. */
  initialPolicy?: RoyaltyClosePolicy;
  loadErrorMessage?: string;
}

const closeModeItems = (disabled: boolean) => [
  {
    description: (
      <ClientMessage message="admin.settings.royalties.mode_options.manual.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.royalties.mode_options.manual.label" />
    ),
    value: "manual",
  },
  {
    description: (
      <ClientMessage message="admin.settings.royalties.mode_options.automatic.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.royalties.mode_options.automatic.label" />
    ),
    value: "automatic",
  },
];

const SubmitLabel = ({ isPending }: { isPending: boolean }) =>
  isPending ? (
    <ClientMessage message="admin.settings.saving" />
  ) : (
    <ClientMessage message="admin.settings.royalties.submit" />
  );

export const RoyaltyCloseSettingsForm = ({
  action,
  canEdit,
  initialPolicy,
  loadErrorMessage,
}: RoyaltyCloseSettingsFormProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const modeId = useId();
  const dayId = useId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [closeMode, setCloseMode] = useState(initialPolicy?.closeMode);
  const [autoCloseDay, setAutoCloseDay] = useState(
    initialPolicy?.autoCloseDay === undefined
      ? null
      : String(initialPolicy.autoCloseDay)
  );

  // Saving after a failed read would replace the stored policy with whatever
  // happened to be picked, so editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);
  const controlsDisabled = fieldsDisabled || isPending;
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  const dayItems = Array.from(
    { length: MAX_ROYALTY_AUTO_CLOSE_DAY },
    (_, index) => ({
      label: t("admin.settings.royalties.day_option", { day: index + 1 }),
      value: String(index + 1),
    })
  );

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.royalties.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.royalties.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-lg">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="close_mode" type="hidden" value={closeMode ?? ""} />

        <Field>
          <FieldLabel htmlFor={modeId}>
            <ClientMessage message="admin.settings.royalties.mode_label" />
          </FieldLabel>
          <FieldContent>
            <RadioGroup
              id={modeId}
              items={closeModeItems(controlsDisabled)}
              onValueChange={(value) => {
                if (isRoyaltyCloseMode(value)) {
                  setCloseMode(value);
                }
              }}
              value={closeMode}
            />
            {fieldErrors?.closeMode ? (
              <FormMessage variant="destructive">
                {fieldErrors.closeMode}
              </FormMessage>
            ) : null}
          </FieldContent>
        </Field>

        {closeMode === "automatic" ? (
          <Field>
            <FieldLabel htmlFor={dayId} required>
              <ClientMessage message="admin.settings.royalties.day_label" />
            </FieldLabel>
            <FieldContent>
              <Select
                className="sm:max-w-48"
                disabled={controlsDisabled}
                id={dayId}
                items={dayItems}
                onValueChange={setAutoCloseDay}
                placeholder={
                  <ClientMessage message="admin.settings.royalties.day_placeholder" />
                }
                value={autoCloseDay}
              />
              <input
                name="auto_close_day"
                type="hidden"
                value={autoCloseDay ?? ""}
              />
              {fieldErrors?.autoCloseDay ? (
                <FormMessage variant="destructive">
                  {fieldErrors.autoCloseDay}
                </FormMessage>
              ) : null}
              <FieldDescription>
                <ClientMessage message="admin.settings.royalties.day_description" />
              </FieldDescription>
            </FieldContent>
          </Field>
        ) : null}

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
          <Button disabled={controlsDisabled} type="submit">
            <SubmitLabel isPending={isPending} />
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
