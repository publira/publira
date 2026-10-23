import { getLocaleLabel, getLocales } from "@publira/i18n";
import * as LocaleSwitcher from "@publira/ui-components/locale-switcher";

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
    <LocaleSwitcher.Root
      action={setPlatformLocaleAction}
      currentLocale={locale}
      fieldName={LOCALE_FIELD_NAME}
    >
      <LocaleSwitcher.Trigger aria-label={label} />
      <LocaleSwitcher.Content>
        <LocaleSwitcher.Title>{label}</LocaleSwitcher.Title>
        <LocaleSwitcher.Options aria-label={label}>
          {getLocales().map((value) => (
            <LocaleSwitcher.Option key={value} locale={value}>
              {getLocaleLabel(value)}
            </LocaleSwitcher.Option>
          ))}
        </LocaleSwitcher.Options>
      </LocaleSwitcher.Content>
    </LocaleSwitcher.Root>
  );
};
