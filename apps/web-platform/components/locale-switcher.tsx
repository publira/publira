import { getLocaleLabel, getLocales } from "@publira/i18n";
import {
  LocaleSwitcher,
  LocaleSwitcherContent,
  LocaleSwitcherOption,
  LocaleSwitcherOptions,
  LocaleSwitcherTitle,
  LocaleSwitcherTrigger,
} from "@publira/ui-components/locale-switcher";

import { getPlatformLocale } from "../lib/locale";
import { setPlatformLocaleAction } from "../lib/locale-action";
import { LOCALE_FIELD_NAME } from "../lib/locale-shared";
import { getMessagesFor } from "../lib/messages";

/** Header display-language control backed by the existing locale cookie. */
export const PlatformLocaleSwitcher = async () => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  const label = t("locale.label");

  return (
    <LocaleSwitcher
      action={setPlatformLocaleAction}
      currentLocale={locale}
      fieldName={LOCALE_FIELD_NAME}
    >
      <LocaleSwitcherTrigger aria-label={label} />
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
