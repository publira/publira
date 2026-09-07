import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";

import { getPlatformLocale, loadPlatformMessages } from "../lib/locale";
import { setPlatformLocaleAction } from "../lib/locale-action";
import { LOCALE_FIELD_NAME } from "../lib/locale-shared";
import {
  LocaleSwitcher,
  LocaleSwitcherContent,
  LocaleSwitcherOption,
  LocaleSwitcherOptions,
  LocaleSwitcherTitle,
  LocaleSwitcherTrigger,
} from "./locale-switcher-control";

/** Header display-language control backed by the existing locale cookie. */
export const PlatformLocaleSwitcher = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);
  const label = getMessage(messages, "locale.label");

  return (
    <LocaleSwitcher
      action={setPlatformLocaleAction}
      currentLocale={locale}
      fieldName={LOCALE_FIELD_NAME}
    >
      <LocaleSwitcherTrigger aria-label={`${label}: ${getLocaleLabel(locale)}`}>
        {getLocaleLabel(locale)}
      </LocaleSwitcherTrigger>
      <LocaleSwitcherContent>
        <LocaleSwitcherTitle>{label}</LocaleSwitcherTitle>
        <LocaleSwitcherOptions aria-label={label}>
          {getLocales().map((value) => (
            <LocaleSwitcherOption key={value} locale={value}>
              {getLocaleLabel(value)}
            </LocaleSwitcherOption>
          ))}
        </LocaleSwitcherOptions>
      </LocaleSwitcherContent>
    </LocaleSwitcher>
  );
};
