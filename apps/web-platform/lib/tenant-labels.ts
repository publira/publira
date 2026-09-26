import type { Locale } from "@publira/i18n";

import { getMessagesFor } from "./messages";

export type TenantStatusTone = "destructive" | "info" | "success";

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
  const t = await getMessagesFor(locale);

  switch (status) {
    case "active": {
      return t("platform.common.tenant_status.active");
    }
    case "inactive": {
      return t("platform.common.tenant_status.inactive");
    }
    case "suspended": {
      return t("platform.common.tenant_status.suspended");
    }
    case "trial": {
      return t("platform.common.tenant_status.trial");
    }
    default: {
      return status;
    }
  }
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
  const t = await getMessagesFor(locale);

  switch (role) {
    case "tenant_admin": {
      return t("platform.common.roles.tenant_admin");
    }
    case "tenant_auditor": {
      return t("platform.common.roles.tenant_auditor");
    }
    case "tenant_editor": {
      return t("platform.common.roles.tenant_editor");
    }
    case "tenant_member": {
      return t("platform.common.roles.tenant_member");
    }
    case "tenant_owner": {
      return t("platform.common.roles.tenant_owner");
    }
    default: {
      return role;
    }
  }
};

export const getInvitationStatusLabel = async (
  status: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  switch (status) {
    case "accepted": {
      return t("platform.common.invitation_status.accepted");
    }
    case "canceled": {
      return t("platform.common.invitation_status.canceled");
    }
    case "expired": {
      return t("platform.common.invitation_status.expired");
    }
    case "pending": {
      return t("platform.common.invitation_status.pending");
    }
    default: {
      return status;
    }
  }
};
