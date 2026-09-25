import type { Locale } from "@publira/i18n";

import { getMessagesFor } from "./messages";

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
