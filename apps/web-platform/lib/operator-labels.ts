import type { Locale } from "@publira/i18n";

import { getMessagesFor } from "./messages";
import { normalizePlatformRole } from "./roles";

export type OperatorRoleTone = "info";

/**
 * Each label takes the `locale` and reads the catalog itself. The value has to
 * be a string — the same label fills a `<select>` item and a table cell — so it
 * cannot be a `<Message>`, and an accessor passed in as an argument would make
 * the key an attribute of whatever the caller happened to bind.
 */
export const getOperatorRoleLabel = async (
  role: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  switch (normalizePlatformRole(role)) {
    case "platform_auditor": {
      return t("platform.common.roles.platform_auditor");
    }
    case "platform_operator": {
      return t("platform.common.roles.platform_operator");
    }
    case "platform_super_admin": {
      return t("platform.common.roles.platform_super_admin");
    }
    default: {
      return role;
    }
  }
};

export const getOperatorStatusLabel = async (
  status: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  switch (status) {
    case "active": {
      return t("platform.common.account_status.active");
    }
    case "inactive": {
      return t("platform.common.account_status.inactive");
    }
    case "suspended": {
      return t("platform.common.account_status.suspended");
    }
    default: {
      return status;
    }
  }
};

export const getOperatorRoleSelectItems = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return [
    {
      label: t("platform.common.roles.platform_super_admin"),
      value: "platform_super_admin",
    },
    {
      label: t("platform.common.roles.platform_operator"),
      value: "platform_operator",
    },
    {
      label: t("platform.common.roles.platform_auditor"),
      value: "platform_auditor",
    },
  ] as const;
};

export const getOperatorRoleCardDescription = async (
  {
    isSelf,
    isSuperAdmin,
  }: {
    isSelf: boolean;
    isSuperAdmin: boolean;
  },
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  if (isSelf) {
    return t("platform.operators.cannot_change_own_role");
  }
  if (!isSuperAdmin) {
    return t("platform.operators.cannot_change_role");
  }
  return t("platform.operators.change_role_description");
};
