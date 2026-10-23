import { getLocaleLabel, getLocales } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import * as PasswordInput from "@publira/ui-components/password-input";
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
    <ActionForm.Root action={setupAction} className="space-y-4">
      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <SetupMessage message="platform.auth.setup.name_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input
            autoComplete="name"
            name="name"
            placeholder={t("platform.auth.setup.name_placeholder")}
            required
            type="text"
          />
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <SetupMessage message="platform.auth.fields.email_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input
            autoComplete="email"
            name="email"
            placeholder="admin@example.com"
            required
            type="email"
          />
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <SetupMessage message="platform.auth.fields.password_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <PasswordInput.Root>
            <PasswordInput.Control
              autoComplete="new-password"
              name="password"
              placeholder="••••••••"
              required
            />
            <PasswordInput.Toggle>
              <Suspense fallback={null}>
                <SetupMessage message="platform.common.show_password" />
              </Suspense>
            </PasswordInput.Toggle>
          </PasswordInput.Root>
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
            <SetupMessage message="platform.auth.setup.confirm_password_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <PasswordInput.Root>
            <PasswordInput.Control
              autoComplete="new-password"
              name="confirmPassword"
              placeholder="••••••••"
              required
            />
            <PasswordInput.Toggle>
              <Suspense fallback={null}>
                <SetupMessage message="platform.common.show_password" />
              </Suspense>
            </PasswordInput.Toggle>
          </PasswordInput.Root>
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <SetupMessage message="platform.auth.setup.default_locale_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Select
            defaultValue={initialDefaultLocale}
            items={localeItems}
            name="default_locale"
            placeholder={t("platform.auth.setup.default_locale_placeholder")}
          />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <SetupMessage message="platform.auth.setup.default_locale_help" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <SetupMessage message="platform.auth.setup.default_timezone_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <SetupTimezoneCombobox>
            <Combobox.Popup>
              <Combobox.Empty>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <SetupMessage message="platform.auth.setup.default_timezone_empty" />
                </Suspense>
              </Combobox.Empty>
              <Combobox.Items />
            </Combobox.Popup>
          </SetupTimezoneCombobox>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <SetupMessage message="platform.auth.setup.default_timezone_help" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <SetupMessage message="platform.auth.setup.default_currency_label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
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
            <Combobox.Popup>
              <Combobox.Empty>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <SetupMessage message="platform.auth.setup.default_currency_empty" />
                </Suspense>
              </Combobox.Empty>
              <Combobox.Items />
            </Combobox.Popup>
          </CurrencyCombobox>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              {currencyLocked ? (
                <SetupMessage message="platform.auth.setup.default_currency_locked" />
              ) : (
                <SetupMessage message="platform.auth.setup.default_currency_help" />
              )}
            </Suspense>
          </Field.Description>
          {currencyUnread ? (
            <FormMessage variant="destructive">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <SetupMessage message="platform.auth.setup.default_currency_load_failed" />
              </Suspense>
            </FormMessage>
          ) : null}
        </Field.Content>
      </Field.Root>

      <ActionForm.Submit className="mt-2 w-full">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <SetupMessage message="platform.auth.setup.submit" />
        </Suspense>
      </ActionForm.Submit>
    </ActionForm.Root>
  );
};
