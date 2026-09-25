"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { useActionState, useState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import type { TenantAgeVerification } from "#lib/tenant-age-verification-shared";
import { isTenantAgeVerification } from "#lib/tenant-age-verification-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantAgeVerificationActionState } from "../settings-types";

interface TenantAgeVerificationFormProps {
  action: (
    prevState: TenantAgeVerificationActionState,
    formData: FormData
  ) => Promise<TenantAgeVerificationActionState>;
  canEdit: boolean;
  /** The saved rule, absent when the read failed. */
  initialAgeVerification?: TenantAgeVerification;
  loadErrorMessage?: string;
}

/**
 * The rungs of the ladder in the order the card offers them: nothing proven,
 * then `r18`, then both ratings.
 */
const ageVerificationItems = (disabled: boolean) => [
  {
    description: (
      <ClientMessage message="admin.settings.age_verification.options.none.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.age_verification.options.none.label" />
    ),
    value: "none",
  },
  {
    description: (
      <ClientMessage message="admin.settings.age_verification.options.r18.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.age_verification.options.r18.label" />
    ),
    value: "r18",
  },
  {
    description: (
      <ClientMessage message="admin.settings.age_verification.options.r15_and_r18.description" />
    ),
    disabled,
    label: (
      <ClientMessage message="admin.settings.age_verification.options.r15_and_r18.label" />
    ),
    value: "r15_and_r18",
  },
];

export const TenantAgeVerificationForm = ({
  action,
  canEdit,
  initialAgeVerification,
  loadErrorMessage,
}: TenantAgeVerificationFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [ageVerification, setAgeVerification] = useState(
    initialAgeVerification
  );

  // A failed read leaves the card with no saved rule to show, so saving from
  // that state would overwrite the tenant's live policy with whatever happened
  // to be picked — opening an `r18` catalogue that was closed, or closing one
  // to every reader who has never given a birth date. Editing stays closed
  // until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const fieldsDisabled = !canEdit || hasLoadError;

  // The controls close while the save is in flight as well. The Action carries
  // what the form held when it was submitted, so a change made in the meantime
  // would sit selected under "The age verification was saved." while the tenant
  // is on the other one.
  const controlsDisabled = fieldsDisabled || isPending;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.age_verification.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.age_verification.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-lg">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="age_verification" type="hidden" value={ageVerification} />

        <Field>
          <FieldLabel htmlFor="tenant_age_verification">
            <ClientMessage message="admin.settings.age_verification.label" />
          </FieldLabel>
          <FieldContent>
            <RadioGroup
              id="tenant_age_verification"
              items={ageVerificationItems(controlsDisabled)}
              onValueChange={(value) => {
                if (isTenantAgeVerification(value)) {
                  setAgeVerification(value);
                }
              }}
              value={ageVerification}
            />
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
              <ClientMessage message="admin.settings.age_verification.load_error_hint" />
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
            <ActionFormIdle>
              <ClientMessage message="admin.settings.age_verification.submit" />
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
