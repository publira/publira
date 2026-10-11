import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { currencyDisplayName, listSupportedCurrencies } from "@publira/utils";

/**
 * The currencies an operator chooses the platform default from, each named in
 * `locale` with its code as the tenant console names a tenant's — `US Dollar
 * (USD)` — so the list can be searched by either, and ordered by that name.
 *
 * Built on the server and handed to the combobox, so the names come from the
 * runtime that lists the codes rather than from whichever ICU data the browser
 * has. `current` is kept when the runtime does not list it: a code the server
 * stored is still the stored one, and dropping it would show the field empty.
 */
export const currencyItems = (
  locale: Locale,
  current?: string
): ComboboxItem[] => {
  const supported = listSupportedCurrencies();
  const codes =
    !current || supported.includes(current)
      ? supported
      : [current, ...supported];
  const collator = new Intl.Collator(toIntlLocale(locale));

  return codes
    .map((code) => ({
      label: `${currencyDisplayName(code, { locale })} (${code})`,
      value: code,
    }))
    .toSorted((left, right) => collator.compare(left.label, right.label));
};
