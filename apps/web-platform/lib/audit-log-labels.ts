import type { Locale } from "@publira/i18n";

import { getMessagesFor } from "./messages";
import { getOperatorRoleLabel } from "./operator-labels";
import { getTenantRoleLabel } from "./tenant-labels";

/** The action filter's options, sorted by label in the UI locale. */
export const getAuditActionOptions = async (
  locale: Locale
): Promise<{ label: string; value: string }[]> => {
  const t = await getMessagesFor(locale);

  return [
    {
      label: t("platform.audit.actions.operator_created"),
      value: "operator_created",
    },
    {
      label: t("platform.audit.actions.operator_deleted"),
      value: "operator_deleted",
    },
    {
      label: t("platform.audit.actions.operator_mfa_disabled"),
      value: "operator_mfa_disabled",
    },
    {
      label: t("platform.audit.actions.operator_mfa_enrolled"),
      value: "operator_mfa_enrolled",
    },
    {
      label: t("platform.audit.actions.operator_mfa_recovery_code_used"),
      value: "operator_mfa_recovery_code_used",
    },
    {
      label: t(
        "platform.audit.actions.operator_mfa_recovery_codes_regenerated"
      ),
      value: "operator_mfa_recovery_codes_regenerated",
    },
    {
      label: t("platform.audit.actions.operator_mfa_verified"),
      value: "operator_mfa_verified",
    },
    {
      label: t("platform.audit.actions.operator_resumed"),
      value: "operator_resumed",
    },
    {
      label: t("platform.audit.actions.operator_suspended"),
      value: "operator_suspended",
    },
    {
      label: t("platform.audit.actions.operator_updated"),
      value: "operator_updated",
    },
    {
      label: t("platform.audit.actions.platform_email_settings_updated"),
      value: "platform_email_settings_updated",
    },
    {
      label: t("platform.audit.actions.platform_policy_updated"),
      value: "platform_policy_updated",
    },
    {
      label: t("platform.audit.actions.platform_retention_defaults_updated"),
      value: "platform_retention_defaults_updated",
    },
    {
      label: t("platform.audit.actions.platform_search_connection_tested"),
      value: "platform_search_connection_tested",
    },
    {
      label: t("platform.audit.actions.platform_search_settings_updated"),
      value: "platform_search_settings_updated",
    },
    {
      label: t("platform.audit.actions.platform_settings_updated"),
      value: "platform_settings_updated",
    },
    {
      label: t("platform.audit.actions.platform_smtp_test_email_sent"),
      value: "platform_smtp_test_email_sent",
    },
    {
      label: t("platform.audit.actions.platform_storage_connection_tested"),
      value: "platform_storage_connection_tested",
    },
    {
      label: t("platform.audit.actions.platform_storage_settings_updated"),
      value: "platform_storage_settings_updated",
    },
    {
      label: t("platform.audit.actions.platform_webpush_subject_updated"),
      value: "platform_webpush_subject_updated",
    },
    {
      label: t("platform.audit.actions.tenant_admin_invite_canceled"),
      value: "tenant_admin_invite_canceled",
    },
    {
      label: t("platform.audit.actions.tenant_admin_invite_resent"),
      value: "tenant_admin_invite_resent",
    },
    {
      label: t("platform.audit.actions.tenant_admin_invited"),
      value: "tenant_admin_invited",
    },
    {
      label: t("platform.audit.actions.tenant_created"),
      value: "tenant_created",
    },
    {
      label: t("platform.audit.actions.tenant_info_updated"),
      value: "tenant_info_updated",
    },
    {
      label: t("platform.audit.actions.tenant_member_added"),
      value: "tenant_member_added",
    },
    {
      label: t("platform.audit.actions.tenant_member_created"),
      value: "tenant_member_created",
    },
    {
      label: t("platform.audit.actions.tenant_member_mfa_reset"),
      value: "tenant_member_mfa_reset",
    },
    {
      label: t("platform.audit.actions.tenant_member_removed"),
      value: "tenant_member_removed",
    },
    {
      label: t("platform.audit.actions.tenant_member_role_updated"),
      value: "tenant_member_role_updated",
    },
    {
      label: t("platform.audit.actions.tenant_resumed"),
      value: "tenant_resumed",
    },
    {
      label: t("platform.audit.actions.tenant_suspended"),
      value: "tenant_suspended",
    },
    { label: t("platform.audit.actions.user_deleted"), value: "user_deleted" },
    {
      label: t("platform.audit.actions.user_suspended"),
      value: "user_suspended",
    },
    {
      label: t("platform.audit.actions.user_unsuspended"),
      value: "user_unsuspended",
    },
  ].toSorted((left, right) => left.label.localeCompare(right.label, locale));
};

/**
 * The actor role an audit entry recorded. `system` is an entry with no
 * operator, which on the platform side only `publiractl` writes.
 */
export const getActorRoleLabel = async (
  role: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (!role) {
    return t("platform.audit.unset");
  }

  const operatorLabel = await getOperatorRoleLabel(role, locale);
  if (operatorLabel !== role) {
    return operatorLabel;
  }

  const tenantLabel = await getTenantRoleLabel(role, locale);
  if (tenantLabel !== role) {
    return tenantLabel;
  }

  switch (role) {
    case "platform_owner": {
      return t("platform.audit.actor_platform");
    }
    case "system": {
      return t("platform.audit.actor_system");
    }
    default: {
      return role;
    }
  }
};
