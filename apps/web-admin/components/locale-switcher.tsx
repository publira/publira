import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";

import { getLocale, loadAdminMessages } from "../lib/locale";
import { setAdminLocaleAction } from "../lib/locale-action";
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
export const AdminLocaleSwitcher = async ({
  tenantId,
}: {
  tenantId: string;
}) => {
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);
  const label = getMessage(messages, "locale.label");

  return (
    <LocaleSwitcher
      action={setAdminLocaleAction}
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
