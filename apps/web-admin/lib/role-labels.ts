import type { Locale } from "@publira/i18n";

import { getMessagesFor } from "./messages";
import type { AdminMessageKey } from "./messages";

/**
 * Roles a tenant console can show. Platform roles never reach this console, so
 * a value outside the map is rendered as-is rather than mapped to a guess.
 *
 * `system` is not a role anyone holds: it is what an audit entry carries when
 * the platform acted on a setting the tenant saved earlier, with no account
 * behind it.
 */
const tenantRoleKeys = {
  system: "admin.common.roles.system",
  tenant_admin: "admin.common.roles.tenant_admin",
  tenant_auditor: "admin.common.roles.tenant_auditor",
  tenant_editor: "admin.common.roles.tenant_editor",
  tenant_member: "admin.common.roles.tenant_member",
  tenant_owner: "admin.common.roles.tenant_owner",
} as const satisfies Record<string, AdminMessageKey>;

export const getTenantRoleLabel = async (
  role: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  const normalized = role.trim().toLowerCase();
  if (!normalized) {
    return t("admin.common.roles.unset");
  }

  const key = tenantRoleKeys[normalized as keyof typeof tenantRoleKeys];

  return key ? t(key) : role.trim();
};
