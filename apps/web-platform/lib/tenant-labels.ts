import type { Locale } from "@publira/i18n";

import type { PlatformMessageKey } from "./locale";
import { getMessagesFor } from "./messages";

export type TenantStatusTone = "destructive" | "info" | "success";

const tenantStatusKeys = new Map<string, PlatformMessageKey>([
  ["active", "platform.common.tenant_status.active"],
  ["inactive", "platform.common.tenant_status.inactive"],
  ["suspended", "platform.common.tenant_status.suspended"],
  ["trial", "platform.common.tenant_status.trial"],
]);

const invitationStatusKeys = new Map<string, PlatformMessageKey>([
  ["accepted", "platform.common.invitation_status.accepted"],
  ["canceled", "platform.common.invitation_status.canceled"],
  ["expired", "platform.common.invitation_status.expired"],
  ["pending", "platform.common.invitation_status.pending"],
]);

const tenantRoleKeys = new Map<string, PlatformMessageKey>([
  ["tenant_admin", "platform.common.roles.tenant_admin"],
  ["tenant_auditor", "platform.common.roles.tenant_auditor"],
  ["tenant_editor", "platform.common.roles.tenant_editor"],
  ["tenant_member", "platform.common.roles.tenant_member"],
  ["tenant_owner", "platform.common.roles.tenant_owner"],
]);

/**
 * Each label takes the `locale` and reads the catalog itself. The value has to
 * be a string — the same label fills a `<select>` item and a table cell — so it
 * cannot be a `<Message>`, and an accessor passed in as an argument would make
 * the key an attribute of whatever the caller happened to bind.
 */
export const getTenantStatusLabel = async (
  status: string,
  locale: Locale
): Promise<string> => {
  const key = tenantStatusKeys.get(status);
  if (!key) {
    return status;
  }

  const t = await getMessagesFor(locale);

  return t(key);
};

export const getTenantStatusTone = (status: string): TenantStatusTone => {
  switch (status) {
    case "active": {
      return "success";
    }
    case "suspended": {
      return "destructive";
    }
    default: {
      return "info";
    }
  }
};

export const getTenantRoleLabel = async (
  role: string,
  locale: Locale
): Promise<string> => {
  const key = tenantRoleKeys.get(role);
  if (!key) {
    return role;
  }

  const t = await getMessagesFor(locale);

  return t(key);
};

export const getInvitationStatusLabel = async (
  status: string,
  locale: Locale
): Promise<string> => {
  const key = invitationStatusKeys.get(status);
  if (!key) {
    return status;
  }

  const t = await getMessagesFor(locale);

  return t(key);
};
