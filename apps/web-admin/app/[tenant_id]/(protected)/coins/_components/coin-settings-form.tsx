import { getLocaleLabel } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  coinNameField,
  COIN_CONTACT_MAX_LENGTH,
  COIN_EXPIRY_DAYS_MAX,
  COIN_ISSUER_NAME_MAX_LENGTH,
  COIN_NAME_MAX_LENGTH,
  COIN_NOTICE_MAX_LENGTH,
  COIN_TERMS_URL_MAX_LENGTH,
} from "#lib/coins";
import type { CoinSettings } from "#lib/coins";
import {
  maxPriceInputValue,
  priceInputStep,
  toPriceInputValue,
} from "#lib/price";
import type { TenantLocales } from "#lib/tenant-locales";

import { updateCoinSettingsAction } from "../_lib/actions";

interface CoinSettingsFormProps {
  /** The tenant's word for its coins in the console's language, or the console's own. */
  coinName: string;
  /** The ISO 4217 code every amount is in. */
  currency: string;
  /** The tenant's word as saved, empty before it has one. */
  savedCoinName: string;
  settings: CoinSettings;
  tenantId: string;
  tenantLocales: TenantLocales;
}

/** The value a field starts from: a zero is an amount not stated yet. */
const statedOrEmpty = (value: number, format: (value: number) => string) =>
  value === 0 ? "" : format(value);

/**
 * The coin's names, what one is worth, how long it lasts, the disclosures, and
 * the two switches, saved together as `UpdateTenantCoinSettings` takes them.
 */
export const CoinSettingsForm = ({
  coinName,
  currency,
  savedCoinName,
  settings,
  tenantId,
  tenantLocales,
}: CoinSettingsFormProps) => {
  const { defaultLocale, supportedLocales } = tenantLocales;

  const savedNames = new Map(
    settings.names.map(({ locale, name }) => [locale, name])
  );

  const coinNameValue = { coin_name: coinName };

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.coins.settings.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.coins.settings.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateCoinSettingsAction}
        className="grid gap-6 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="currency" type="hidden" value={currency} />
        <input name="coin_name" type="hidden" value={savedCoinName} />
        {/* A save refreshes the settings; keying on them remounts the fields
            on what the API stored instead of changing a mounted default. */}
        <ActionForm.Fieldset
          className="grid gap-6"
          key={JSON.stringify(settings)}
        >
          <fieldset className="grid min-w-0 gap-4">
            <legend className="mb-2 text-sm font-medium text-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.coins.settings.names" />
              </Suspense>
            </legend>
            {[
              defaultLocale,
              ...supportedLocales.filter((code) => code !== defaultLocale),
            ].map((code) => {
              const isDefault = code === defaultLocale;

              return (
                <Field.Root key={code}>
                  <Field.Label required={isDefault}>
                    {/* An autonym, read in the language it names. */}
                    <span lang={code}>{getLocaleLabel(code)}</span>
                  </Field.Label>
                  <Field.Content>
                    <Input
                      className="sm:max-w-sm"
                      defaultValue={savedNames.get(code) ?? ""}
                      lang={code}
                      maxLength={COIN_NAME_MAX_LENGTH}
                      name={coinNameField(code)}
                      type="text"
                    />
                    <ActionForm.FieldError name={coinNameField(code)} />
                  </Field.Content>
                </Field.Root>
              );
            })}
            <p className="text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-3/4" />}>
                <Message
                  message="admin.coins.settings.names_description"
                  values={{ language: getLocaleLabel(defaultLocale) }}
                />
              </Suspense>
            </p>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <Message message="admin.coins.settings.unit_amount" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={statedOrEmpty(
                    settings.coinUnitAmount,
                    (value) => toPriceInputValue(value, currency)
                  )}
                  max={maxPriceInputValue(currency)}
                  min="0"
                  name="coin_unit_amount"
                  step={priceInputStep(currency)}
                  type="number"
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.coins.settings.unit_amount_description"
                      values={{ ...coinNameValue, currency }}
                    />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="coinUnitAmount" />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <Message message="admin.coins.settings.expiry_days" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={statedOrEmpty(settings.expiryDays, String)}
                  max={COIN_EXPIRY_DAYS_MAX}
                  min="0"
                  name="expiry_days"
                  step="1"
                  type="number"
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.coins.settings.expiry_days_description"
                      values={{ ...coinNameValue, max: COIN_EXPIRY_DAYS_MAX }}
                    />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="expiryDays" />
              </Field.Content>
            </Field.Root>
          </div>

          <fieldset className="grid min-w-0 gap-4">
            <legend className="mb-1 text-sm font-medium text-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.coins.settings.disclosures" />
              </Suspense>
            </legend>
            <p className="text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message
                  message="admin.coins.settings.disclosures_description"
                  values={coinNameValue}
                />
              </Suspense>
            </p>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.coins.settings.issuer_name" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  className="sm:max-w-md"
                  defaultValue={settings.issuerName}
                  maxLength={COIN_ISSUER_NAME_MAX_LENGTH}
                  name="issuer_name"
                  type="text"
                />
                <ActionForm.FieldError name="issuerName" />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.coins.settings.terms_url" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={settings.termsUrl}
                  inputMode="url"
                  maxLength={COIN_TERMS_URL_MAX_LENGTH}
                  name="terms_url"
                  placeholder="https://"
                  type="text"
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.coins.settings.terms_url_description" />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="termsUrl" />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.coins.settings.contact" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Textarea
                  defaultValue={settings.contact}
                  maxLength={COIN_CONTACT_MAX_LENGTH}
                  name="contact"
                  rows={2}
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.coins.settings.contact_description"
                      values={coinNameValue}
                    />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="contact" />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.coins.settings.notice" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Textarea
                  defaultValue={settings.notice}
                  maxLength={COIN_NOTICE_MAX_LENGTH}
                  name="notice"
                  rows={4}
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.coins.settings.notice_description"
                      values={coinNameValue}
                    />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="notice" />
              </Field.Content>
            </Field.Root>
          </fieldset>

          <div className="grid gap-4">
            <Field.Root>
              <div className="flex items-center gap-2">
                <Checkbox defaultChecked={settings.enabled} name="enabled" />
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.coins.settings.enabled" />
                  </Suspense>
                </Field.Label>
              </div>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message
                    message="admin.coins.settings.enabled_description"
                    values={coinNameValue}
                  />
                </Suspense>
              </Field.Description>
              <ActionForm.FieldError name="enabled" />
            </Field.Root>

            <Field.Root>
              <div className="flex items-center gap-2">
                <Checkbox defaultChecked={settings.selling} name="selling" />
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.coins.settings.selling" />
                  </Suspense>
                </Field.Label>
              </div>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message
                    message="admin.coins.settings.selling_description"
                    values={coinNameValue}
                  />
                </Suspense>
              </Field.Description>
            </Field.Root>
          </div>
        </ActionForm.Fieldset>

        <div className="flex flex-wrap gap-3">
          <ActionForm.Submit>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <ActionForm.Idle>
                <Message message="admin.coins.settings.submit" />
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
