import { getLocaleLabel, getLocales } from "@publira/i18n";
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
import { Input } from "@publira/ui-components/input";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@publira/ui-components/password-input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { CurrencyCombobox } from "#components/currency-combobox";
import { currencyItems } from "#lib/currency-items";
import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformCurrencyForSetup } from "#lib/platform-settings";

import { setupAction } from "../_lib/actions";
import { SetupMessage } from "./setup-message";
import { SetupTimezoneCombobox } from "./setup-timezone-combobox";

export const SetupForm = async () => {
  // Nothing is stored yet, so the header decides both the language this screen
  // renders in and which option opens selected. The saved value is whatever the
  // operator submits from this list.
  const [initialDefaultLocale, storedCurrency] = await Promise.all([
    getInitialLocaleCandidate(),
    getPlatformCurrencyForSetup(),
  ]);
  const t = await getMessagesFor(initialDefaultLocale);
  // The currency starts on the one `publiractl setup` saved, so confirming
  // the form keeps it; on a platform with no settings, the operator chooses
  // one. A locked currency, or one that could not be read, is not offered for
  // change at all: the field posts nothing, which keeps what is stored.
  const savedCurrency =
    storedCurrency.state === "saved" ? storedCurrency : undefined;
  const currencyLocked = savedCurrency?.defaultCurrencyLocked ?? false;
  const currencyUnread = storedCurrency.state === "failed";
  const localeItems = getLocales().map((value) => ({
    label: getLocaleLabel(value),
    value,
  }));

  return (
    <ActionForm action={setupAction} className="space-y-4">
      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <SetupMessage message="platform.auth.setup.name_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="name"
            name="name"
            placeholder={t("platform.auth.setup.name_placeholder")}
            required
            type="text"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <SetupMessage message="platform.auth.fields.email_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            autoComplete="email"
            name="email"
            placeholder="admin@example.com"
            required
            type="email"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <SetupMessage message="platform.auth.fields.password_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <PasswordInput>
            <PasswordInputControl
              autoComplete="new-password"
              name="password"
              placeholder="••••••••"
              required
            />
            <PasswordInputToggle>
              <Suspense fallback={null}>
                <SetupMessage message="platform.common.show_password" />
              </Suspense>
            </PasswordInputToggle>
          </PasswordInput>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <SetupMessage message="platform.auth.setup.confirm_password_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <PasswordInput>
            <PasswordInputControl
              autoComplete="new-password"
              name="confirmPassword"
              placeholder="••••••••"
              required
            />
            <PasswordInputToggle>
              <Suspense fallback={null}>
                <SetupMessage message="platform.common.show_password" />
              </Suspense>
            </PasswordInputToggle>
          </PasswordInput>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <SetupMessage message="platform.auth.setup.default_locale_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Select
            defaultValue={initialDefaultLocale}
            items={localeItems}
            name="default_locale"
            placeholder={t("platform.auth.setup.default_locale_placeholder")}
          />
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <SetupMessage message="platform.auth.setup.default_locale_help" />
            </Suspense>
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <SetupMessage message="platform.auth.setup.default_timezone_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <SetupTimezoneCombobox>
            <ComboboxPopup>
              <ComboboxEmpty>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <SetupMessage message="platform.auth.setup.default_timezone_empty" />
                </Suspense>
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </SetupTimezoneCombobox>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <SetupMessage message="platform.auth.setup.default_timezone_help" />
            </Suspense>
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <SetupMessage message="platform.auth.setup.default_currency_label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <CurrencyCombobox
            disabled={currencyLocked || currencyUnread}
            initialCurrency={savedCurrency?.defaultCurrency ?? ""}
            items={currencyItems(
              initialDefaultLocale,
              savedCurrency?.defaultCurrency
            )}
            name="default_currency"
            placeholder={t("platform.auth.setup.default_currency_placeholder")}
          >
            <ComboboxPopup>
              <ComboboxEmpty>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <SetupMessage message="platform.auth.setup.default_currency_empty" />
                </Suspense>
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </CurrencyCombobox>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              {currencyLocked ? (
                <SetupMessage message="platform.auth.setup.default_currency_locked" />
              ) : (
                <SetupMessage message="platform.auth.setup.default_currency_help" />
              )}
            </Suspense>
          </FieldDescription>
          {currencyUnread ? (
            <FormMessage variant="destructive">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <SetupMessage message="platform.auth.setup.default_currency_load_failed" />
              </Suspense>
            </FormMessage>
          ) : null}
        </FieldContent>
      </Field>

      <ActionFormSubmit className="mt-2 w-full">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <SetupMessage message="platform.auth.setup.submit" />
        </Suspense>
      </ActionFormSubmit>
    </ActionForm>
  );
};
