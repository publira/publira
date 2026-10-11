import {
  ActionForm,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  ComboboxEmpty,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { CurrencyCombobox } from "#components/currency-combobox";
import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import { currencyItems } from "#lib/currency-items";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { updatePlatformDefaultCurrencyAction } from "../_lib/actions";

interface PlatformDefaultCurrencyFormProps {
  /** The saved value, absent when the settings read failed. */
  initialDefaultCurrency?: string;
  /** Whether a tenant that sells in the saved value has a purchase. */
  locked: boolean;
  loadErrorMessage?: string;
}

/**
 * The currency every tenant with no payment settings of its own sells in.
 * Once such a tenant has a purchase the field is read-only and says why, as
 * the tenant console's own currency field does.
 */
export const PlatformDefaultCurrencyForm = async ({
  initialDefaultCurrency,
  loadErrorMessage,
  locked,
}: PlatformDefaultCurrencyFormProps) => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  // A failed read has no stored currency to start on, and saving from that
  // state would write whatever the field showed over it.
  const disabled = Boolean(loadErrorMessage) || locked;

  return (
    <PlatformSection>
      <PlatformSectionHeader>
        <PlatformSectionHeading>
          <PlatformSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="platform.settings.default_currency_title" />
            </Suspense>
          </PlatformSectionTitle>
          <PlatformSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message message="platform.settings.default_currency_description" />
            </Suspense>
          </PlatformSectionDescription>
        </PlatformSectionHeading>
      </PlatformSectionHeader>
      <ActionForm
        action={updatePlatformDefaultCurrencyAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.settings.default_currency_label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            {/* A save refreshes the stored value and the lock; keying on them
                remounts the field on what is stored. */}
            <CurrencyCombobox
              disabled={disabled}
              initialCurrency={initialDefaultCurrency ?? ""}
              items={currencyItems(locale, initialDefaultCurrency)}
              key={`${initialDefaultCurrency}:${locked}`}
              name="default_currency"
              placeholder={t("platform.settings.default_currency_placeholder")}
            >
              <ComboboxPopup>
                <ComboboxEmpty>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="platform.settings.default_currency_empty" />
                  </Suspense>
                </ComboboxEmpty>
                <ComboboxItems />
              </ComboboxPopup>
            </CurrencyCombobox>
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                {locked ? (
                  <Message message="platform.settings.default_currency_locked" />
                ) : (
                  <Message message="platform.settings.default_currency_help" />
                )}
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            {loadErrorMessage}
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="platform.settings.default_currency_reload" />
            </Suspense>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={disabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.settings.default_currency_save" />
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </PlatformSection>
  );
};
