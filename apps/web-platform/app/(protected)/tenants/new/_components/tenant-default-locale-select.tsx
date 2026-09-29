import { getLocaleLabel, getLocales } from "@publira/i18n";
import { Select } from "@publira/ui-components/select";

import { getInitialLocaleCandidate } from "#lib/initial-locale";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

/**
 * The new tenant's default language.
 *
 * A tenant that does not exist yet has nothing stored to open on, so the
 * operator's `Accept-Language` seeds the selection the same way it does on
 * `/setup`. It is only a starting point: the value sent to the API is whatever
 * is submitted, and the Server Action checks it against the supported locales.
 */
export const TenantDefaultLocaleSelect = async () => {
  const [locale, initialDefaultLocale] = await Promise.all([
    getPlatformLocale(),
    getInitialLocaleCandidate(),
  ]);
  const t = await getMessagesFor(locale);

  return (
    <Select
      defaultValue={initialDefaultLocale}
      items={getLocales().map((value) => ({
        label: getLocaleLabel(value),
        value,
      }))}
      name="tenant_default_locale"
      placeholder={t("platform.tenants.default_locale_placeholder")}
    />
  );
};
