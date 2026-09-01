import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";

import { getPlatformLocale, loadPlatformMessages } from "../lib/locale";
import { setPlatformLocaleAction } from "../lib/locale-action";
import { LOCALE_FIELD_NAME } from "../lib/locale-shared";
import { LocaleSwitcher } from "./locale-switcher-control";

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
