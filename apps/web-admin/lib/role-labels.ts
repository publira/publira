import type { Locale } from "@publira/i18n";

import { getMessagesFor } from "./messages";

/**
 * Roles a tenant console can show. Platform roles never reach this console, so
 * a value outside the list is rendered as-is rather than mapped to a guess.
 *
 * `system` is not a role anyone holds: it is what an audit entry carries when
 * the platform acted on a setting the tenant saved earlier, with no account
 * behind it.
 */
export const getTenantRoleLabel = async (
  role: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  switch (role.trim().toLowerCase()) {
    case "": {
      return t("admin.common.roles.unset");
    }
    case "system": {
      return t("admin.common.roles.system");
    }
    case "tenant_admin": {
      return t("admin.common.roles.tenant_admin");
    }
    case "tenant_auditor": {
      return t("admin.common.roles.tenant_auditor");
    }
    case "tenant_editor": {
      return t("admin.common.roles.tenant_editor");
    }
    case "tenant_member": {
      return t("admin.common.roles.tenant_member");
    }
    case "tenant_owner": {
      return t("admin.common.roles.tenant_owner");
    }
    default: {
      return role.trim();
    }
  }
};
