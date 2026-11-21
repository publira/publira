import { getLocaleLabel, getLocales } from "@publira/i18n";
import * as LocaleSwitcher from "@publira/ui-components/locale-switcher";

import { getLocale } from "../lib/locale";
import { getMessagesFor } from "../lib/messages";
import { AdminLocaleSwitcherRoot } from "./locale-switcher-root";

/** Header display-language control backed by the existing locale cookie. */
export const AdminLocaleSwitcher = async () => {
  const locale = await getLocale();
  const t = await getMessagesFor(locale);
  const label = t("locale.label");

  return (
    <AdminLocaleSwitcherRoot currentLocale={locale}>
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
    </AdminLocaleSwitcherRoot>
  );
};
