import { getLocaleLabel, getLocales } from "@publira/i18n";
import * as LocaleSwitcher from "@publira/ui-components/locale-switcher";

import { getLocale } from "../lib/locale";
import { setAdminLocaleAction } from "../lib/locale-action";
import { LOCALE_FIELD_NAME } from "../lib/locale-shared";
import { getMessagesFor } from "../lib/messages";
import { getTenantId } from "../lib/tenant-id";

/** Header display-language control backed by the existing locale cookie. */
export const AdminLocaleSwitcher = async () => {
  const locale = await getLocale(await getTenantId());
  const t = await getMessagesFor(locale);
  const label = t("locale.label");

  return (
    <LocaleSwitcher.Root
      action={setAdminLocaleAction}
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
