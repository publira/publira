import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { shareBpsToPercentText } from "#lib/credit-share";
import type { TenantTaxSettings } from "#lib/tenant-tax-settings";
import {
  MAX_INVOICE_LEGAL_NAME_LENGTH,
  MAX_INVOICE_REGISTRATION_NUMBER_LENGTH,
} from "#lib/tenant-tax-settings-shared";

import { updateTenantTaxSettingsAction } from "../_lib/actions";

interface TenantTaxSettingsFormProps {
  canEdit: boolean;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantTaxSettings;
  loadErrorMessage?: string;
  locale: Locale;
  tenantId: string;
  /** The tenant's zone, which the date the rate applies from is shown in. */
  timeZone: string;
}

/** The text a rate field opens on: the saved rate, or empty for none. */
const rateText = (bps: number | null | undefined): string =>
  bps === null || bps === undefined ? "" : shareBpsToPercentText(bps);

/**
 * A field of the card: its label, its input, what the Action said about it,
 * and what it is for.
 */
const TaxField = ({
  children,
  description,
  errorName,
  label,
}: {
  children: ReactNode;
  description: ReactNode;
  errorName: string;
  label: ReactNode;
}) => (
  <Field.Root>
    <Field.Label>{label}</Field.Label>
    <Field.Content>
      {children}
      <ActionForm.FieldError name={errorName} />
      <Field.Description>{description}</Field.Description>
    </Field.Content>
  </Field.Root>
);

export const TenantTaxSettingsForm = ({
  canEdit,
  initialSettings,
  loadErrorMessage,
  locale,
  tenantId,
  timeZone,
}: TenantTaxSettingsFormProps) => {
  // A save writes every field, so without the saved ones it would clear the
  // tenant's rate and invoice details; editing stays closed until the read
  // succeeds.
  const fieldsDisabled = !canEdit || initialSettings === undefined;
  const taxRate = rateText(initialSettings?.taxRateBps);
  const withholdingRate = rateText(initialSettings?.withholdingRateBps);
  const legalName = initialSettings?.invoiceLegalName ?? "";
  const registrationNumber = initialSettings?.invoiceRegistrationNumber ?? "";

  // The fields are uncontrolled and read their default once, so they are
  // keyed by what is stored: a save that re-renders the screen with the
  // server's trimmed values starts them from those.
  const fieldsKey = [
    taxRate,
    withholdingRate,
    legalName,
    registrationNumber,
  ].join("\n");

  const appliesFrom =
    initialSettings?.taxRateBps !== null && initialSettings?.taxRateAppliesFrom
      ? formatDateTime(initialSettings.taxRateAppliesFrom, { locale, timeZone })
      : "";

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.settings.tax.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.tax.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantTaxSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionForm.Fieldset
          className="grid gap-4"
          disabled={fieldsDisabled}
          key={fieldsKey}
        >
          <TaxField
            description={
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.tax.rate_description" />
                {appliesFrom ? (
                  <>
                    {" "}
                    <Message
                      message="admin.settings.tax.rate_applies_from"
                      values={{ applies_from: appliesFrom }}
                    />
                  </>
                ) : null}
              </Suspense>
            }
            errorName="taxRateBps"
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.tax.rate_label" />
              </Suspense>
            }
          >
            <Input
              autoComplete="off"
              className="sm:max-w-32"
              defaultValue={taxRate}
              inputMode="decimal"
              name="tax_rate"
            />
          </TaxField>

          <TaxField
            description={
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.tax.withholding_description" />
              </Suspense>
            }
            errorName="withholdingRateBps"
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.tax.withholding_label" />
              </Suspense>
            }
          >
            <Input
              autoComplete="off"
              className="sm:max-w-32"
              defaultValue={withholdingRate}
              inputMode="decimal"
              name="withholding_rate"
            />
          </TaxField>

          <TaxField
            description={
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message
                  message="admin.settings.tax.legal_name_description"
                  values={{ max: MAX_INVOICE_LEGAL_NAME_LENGTH }}
                />
              </Suspense>
            }
            errorName="invoiceLegalName"
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.tax.legal_name_label" />
              </Suspense>
            }
          >
            <Input
              autoComplete="organization"
              defaultValue={legalName}
              name="invoice_legal_name"
            />
          </TaxField>

          <TaxField
            description={
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message
                  message="admin.settings.tax.registration_number_description"
                  values={{ max: MAX_INVOICE_REGISTRATION_NUMBER_LENGTH }}
                />
              </Suspense>
            }
            errorName="invoiceRegistrationNumber"
            label={
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.settings.tax.registration_number_label" />
              </Suspense>
            }
          >
            <Input
              autoCapitalize="characters"
              autoComplete="off"
              defaultValue={registrationNumber}
              name="invoice_registration_number"
              spellCheck={false}
            />
          </TaxField>
        </ActionForm.Fieldset>

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
                <Message message="admin.settings.tax.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.tax.submit" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
