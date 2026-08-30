import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
import { LocaleSwitcher } from "@publira/ui-components/locale-switcher";

import { getLocale, loadAdminMessages } from "../lib/locale";
import { setAdminLocaleAction } from "../lib/locale-action";
import { LOCALE_FIELD_NAME } from "../lib/locale-shared";

/** Header display-language control backed by the existing locale cookie. */
export const AdminLocaleSwitcher = async ({
  tenantId,
}: {
  tenantId: string;
}) => {
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return (
    <LocaleSwitcher
      action={setAdminLocaleAction}
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
