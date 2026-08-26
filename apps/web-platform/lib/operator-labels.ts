import { getMessage } from "@publira/i18n";

import type { PlatformMessageKey, PlatformMessages } from "./locale";
import { normalizePlatformRole } from "./roles";

export type OperatorRoleTone = "info";

const operatorRoleKeys = {
  platform_auditor: "platform.common.roles.platform_auditor",
  platform_operator: "platform.common.roles.platform_operator",
  platform_super_admin: "platform.common.roles.platform_super_admin",
} as const satisfies Record<string, PlatformMessageKey>;

const accountStatusKeys = {
  active: "platform.common.account_status.active",
  inactive: "platform.common.account_status.inactive",
  suspended: "platform.common.account_status.suspended",
} as const satisfies Record<string, PlatformMessageKey>;

export const getOperatorRoleLabel = (
  role: string,
  messages: PlatformMessages
): string => {
  const key = operatorRoleKeys[normalizePlatformRole(role)];
  return key ? getMessage(messages, key) : role;
};

export const getOperatorStatusLabel = (
  status: string,
  messages: PlatformMessages
): string => {
  const key = accountStatusKeys[status];
  return key ? getMessage(messages, key) : status;
};

export const getOperatorRoleSelectItems = (messages: PlatformMessages) =>
  [
    {
      label: getMessage(messages, "platform.common.roles.platform_super_admin"),
      value: "platform_super_admin",
    },
    {
      label: getMessage(messages, "platform.common.roles.platform_operator"),
      value: "platform_operator",
    },
    {
      label: getMessage(messages, "platform.common.roles.platform_auditor"),
      value: "platform_auditor",
    },
  ] as const;

export const getOperatorRoleCardDescription = (
  {
    isSelf,
    isSuperAdmin,
  }: {
    isSelf: boolean;
    isSuperAdmin: boolean;
  },
  messages: PlatformMessages
): string => {
  if (isSelf) {
    return getMessage(messages, "platform.operators.cannot_change_own_role");
  }
  if (!isSuperAdmin) {
    return getMessage(messages, "platform.operators.cannot_change_role");
  }
  return getMessage(messages, "platform.operators.change_role_description");
};
