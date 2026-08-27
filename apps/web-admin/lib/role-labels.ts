import { getMessage } from "@publira/i18n";

import type { AdminMessageKey, AdminMessages } from "./messages";

/**
 * Roles a tenant console can show. Platform roles never reach this console, so
 * a value outside the map is rendered as-is rather than mapped to a guess.
 */
const tenantRoleKeys = {
  tenant_admin: "admin.common.roles.tenant_admin",
  tenant_auditor: "admin.common.roles.tenant_auditor",
  tenant_editor: "admin.common.roles.tenant_editor",
  tenant_member: "admin.common.roles.tenant_member",
  tenant_owner: "admin.common.roles.tenant_owner",
} as const satisfies Record<string, AdminMessageKey>;

export const getTenantRoleLabel = (
  role: string,
  messages: AdminMessages
): string => {
  const normalized = role.trim().toLowerCase();
  if (!normalized) {
    return getMessage(messages, "admin.common.roles.unset");
  }

  const key = tenantRoleKeys[normalized as keyof typeof tenantRoleKeys];

  return key ? getMessage(messages, key) : role.trim();
};
