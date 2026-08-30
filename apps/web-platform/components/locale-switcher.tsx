import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
import { LocaleSwitcher } from "@publira/ui-components/locale-switcher";

import { getPlatformLocale, loadPlatformMessages } from "../lib/locale";
import { setPlatformLocaleAction } from "../lib/locale-action";
import { LOCALE_FIELD_NAME } from "../lib/locale-shared";

/** Header display-language control backed by the existing locale cookie. */
export const PlatformLocaleSwitcher = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <LocaleSwitcher
      action={setPlatformLocaleAction}
      currentLocale={locale}
      fieldName={LOCALE_FIELD_NAME}
      label={getMessage(messages, "locale.label")}
      options={getLocales().map((value) => ({
        label: getLocaleLabel(value),
        locale: value,
      }))}
    />
  );
};
