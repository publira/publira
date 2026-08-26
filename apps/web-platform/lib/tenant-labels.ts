import { getMessage } from "@publira/i18n";

import type { PlatformMessageKey, PlatformMessages } from "./locale";

export type TenantStatusTone = "destructive" | "info" | "success";

const tenantStatusKeys = {
  active: "platform.common.tenant_status.active",
  inactive: "platform.common.tenant_status.inactive",
  suspended: "platform.common.tenant_status.suspended",
  trial: "platform.common.tenant_status.trial",
} as const satisfies Record<string, PlatformMessageKey>;

const invitationStatusKeys = {
  accepted: "platform.common.invitation_status.accepted",
  canceled: "platform.common.invitation_status.canceled",
  expired: "platform.common.invitation_status.expired",
  pending: "platform.common.invitation_status.pending",
} as const satisfies Record<string, PlatformMessageKey>;

const tenantRoleKeys = {
  tenant_admin: "platform.common.roles.tenant_admin",
  tenant_auditor: "platform.common.roles.tenant_auditor",
  tenant_editor: "platform.common.roles.tenant_editor",
  tenant_member: "platform.common.roles.tenant_member",
  tenant_owner: "platform.common.roles.tenant_owner",
} as const satisfies Record<string, PlatformMessageKey>;

export const getTenantStatusLabel = (
  status: string,
  messages: PlatformMessages
): string => {
  const key = tenantStatusKeys[status];
  return key ? getMessage(messages, key) : status;
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

export const getTenantRoleLabel = (
  role: string,
  messages: PlatformMessages
): string => {
  const key = tenantRoleKeys[role];
  return key ? getMessage(messages, key) : role;
};

export const getInvitationStatusLabel = (
  status: string,
  messages: PlatformMessages
): string => {
  const key = invitationStatusKeys[status];
  return key ? getMessage(messages, key) : status;
};
