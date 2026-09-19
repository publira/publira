import type { Locale } from "@publira/i18n";

import type { PlatformMessageKey } from "./locale";
import { getMessagesFor } from "./messages";

const auditActionKeys = {
  operator_created: "platform.audit.actions.operator_created",
  operator_deleted: "platform.audit.actions.operator_deleted",
  operator_resumed: "platform.audit.actions.operator_resumed",
  operator_suspended: "platform.audit.actions.operator_suspended",
  operator_updated: "platform.audit.actions.operator_updated",
  platform_email_settings_updated:
    "platform.audit.actions.platform_email_settings_updated",
  platform_policy_updated: "platform.audit.actions.platform_policy_updated",
  platform_settings_updated: "platform.audit.actions.platform_settings_updated",
  platform_smtp_test_email_sent:
    "platform.audit.actions.platform_smtp_test_email_sent",
  tenant_created: "platform.audit.actions.tenant_created",
  tenant_info_updated: "platform.audit.actions.tenant_info_updated",
  tenant_resumed: "platform.audit.actions.tenant_resumed",
  tenant_suspended: "platform.audit.actions.tenant_suspended",
  user_activated: "platform.audit.actions.user_activated",
  user_deleted: "platform.audit.actions.user_deleted",
  user_suspended: "platform.audit.actions.user_suspended",
} as const satisfies Record<string, PlatformMessageKey>;

export const getAuditActionOptions = async (
  locale: Locale
): Promise<{ label: string; value: string }[]> => {
  const t = await getMessagesFor(locale);

  return Object.entries(auditActionKeys)
    .map(([value, key]) => ({
      label: t(key),
      value,
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label, locale));
};

export const getAuditActionLabel = async (
  action: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  const normalized = action.trim();
  if (!normalized) {
    return t("platform.audit.unset");
  }

  const key = auditActionKeys[normalized as keyof typeof auditActionKeys];
  return key ? t(key) : normalized;
};
