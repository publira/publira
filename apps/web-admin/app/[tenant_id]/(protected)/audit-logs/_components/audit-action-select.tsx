"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";

import { useClientMessages } from "#components/client-message";

interface AuditActionSelectProps {
  defaultValue: string;
}

export const AuditActionSelect = ({ defaultValue }: AuditActionSelectProps) => {
  const t = useClientMessages();

  return (
    <Field>
      <FieldLabel>{t("admin.audit.filter.action")}</FieldLabel>
      <FieldContent>
        <Select
          defaultValue={defaultValue}
          items={[
            { label: t("admin.audit.actions.all"), value: "" },
            {
              label: t("admin.audit.actions.series_created"),
              value: "series_created",
            },
            {
              label: t("admin.audit.actions.series_updated"),
              value: "series_updated",
            },
            {
              label: t(
                "admin.audit.actions.series_eye_catch_aspect_image_uploaded"
              ),
              value: "series_eye_catch_aspect_image_uploaded",
            },
            {
              label: t("admin.audit.actions.series_free_windows_created"),
              value: "series_free_windows_created",
            },
            {
              label: t("admin.audit.actions.episode_created"),
              value: "episode_created",
            },
            {
              label: t("admin.audit.actions.episode_updated"),
              value: "episode_updated",
            },
            {
              label: t("admin.audit.actions.episode_image_uploaded"),
              value: "episode_image_uploaded",
            },
            {
              label: t("admin.audit.actions.episode_credits_replaced"),
              value: "episode_credits_replaced",
            },
            {
              label: t("admin.audit.actions.episode_credits_bulk_edited"),
              value: "episode_credits_bulk_edited",
            },
            {
              label: t("admin.audit.actions.episode_free_window_created"),
              value: "episode_free_window_created",
            },
            {
              label: t("admin.audit.actions.episode_free_window_deleted"),
              value: "episode_free_window_deleted",
            },
            {
              label: t("admin.audit.actions.creator_created"),
              value: "creator_created",
            },
            {
              label: t("admin.audit.actions.creator_updated"),
              value: "creator_updated",
            },
            {
              label: t("admin.audit.actions.creator_role_created"),
              value: "creator_role_created",
            },
            {
              label: t("admin.audit.actions.creator_role_updated"),
              value: "creator_role_updated",
            },
            {
              label: t("admin.audit.actions.creator_role_deleted"),
              value: "creator_role_deleted",
            },
            {
              label: t("admin.audit.actions.creator_roles_reordered"),
              value: "creator_roles_reordered",
            },
            {
              label: t("admin.audit.actions.label_created"),
              value: "label_created",
            },
            {
              label: t("admin.audit.actions.label_updated"),
              value: "label_updated",
            },
            {
              label: t(
                "admin.audit.actions.label_eye_catch_aspect_image_uploaded"
              ),
              value: "label_eye_catch_aspect_image_uploaded",
            },
            {
              label: t("admin.audit.actions.genre_created"),
              value: "genre_created",
            },
            {
              label: t("admin.audit.actions.genre_updated"),
              value: "genre_updated",
            },
            {
              label: t("admin.audit.actions.genre_deleted"),
              value: "genre_deleted",
            },
            {
              label: t("admin.audit.actions.genres_reordered"),
              value: "genres_reordered",
            },
            {
              label: t(
                "admin.audit.actions.genre_eye_catch_aspect_image_uploaded"
              ),
              value: "genre_eye_catch_aspect_image_uploaded",
            },
            {
              label: t("admin.audit.actions.page_created"),
              value: "page_created",
            },
            {
              label: t("admin.audit.actions.page_updated"),
              value: "page_updated",
            },
            {
              label: t("admin.audit.actions.page_unpublished"),
              value: "page_unpublished",
            },
            {
              label: t("admin.audit.actions.page_version_created"),
              value: "page_version_created",
            },
            {
              label: t("admin.audit.actions.page_version_published"),
              value: "page_version_published",
            },
            {
              label: t("admin.audit.actions.page_version_rolled_back"),
              value: "page_version_rolled_back",
            },
            {
              label: t("admin.audit.actions.announcement_created"),
              value: "announcement_created",
            },
            {
              label: t("admin.audit.actions.announcement_unpinned"),
              value: "announcement_unpinned",
            },
            {
              label: t("admin.audit.actions.comment_approved"),
              value: "comment_approved",
            },
            {
              label: t("admin.audit.actions.comment_hidden"),
              value: "comment_hidden",
            },
            {
              label: t("admin.audit.actions.comment_auto_hidden"),
              value: "comment_auto_hidden",
            },
            {
              label: t("admin.audit.actions.comment_restored"),
              value: "comment_restored",
            },
            {
              label: t("admin.audit.actions.comment_purged"),
              value: "comment_purged",
            },
            {
              label: t("admin.audit.actions.comment_report_resolved"),
              value: "comment_report_resolved",
            },
            {
              label: t("admin.audit.actions.comment_report_rejected"),
              value: "comment_report_rejected",
            },
            {
              label: t("admin.audit.actions.contact_message_handled"),
              value: "contact_message_handled",
            },
            {
              label: t("admin.audit.actions.contact_message_reopened"),
              value: "contact_message_reopened",
            },
            {
              label: t("admin.audit.actions.reader_suspended"),
              value: "reader_suspended",
            },
            {
              label: t("admin.audit.actions.reader_unsuspended"),
              value: "reader_unsuspended",
            },
            {
              label: t("admin.audit.actions.reader_birth_date_changed"),
              value: "reader_birth_date_changed",
            },
            {
              label: t("admin.audit.actions.reader_birth_date_cleared"),
              value: "reader_birth_date_cleared",
            },
            {
              label: t("admin.audit.actions.reader_deleted"),
              value: "reader_deleted",
            },
            {
              label: t("admin.audit.actions.access_ticket_issued"),
              value: "access_ticket_issued",
            },
            {
              label: t("admin.audit.actions.access_ticket_revoked"),
              value: "access_ticket_revoked",
            },
            {
              label: t("admin.audit.actions.royalty_config_updated"),
              value: "royalty_config_updated",
            },
            {
              label: t("admin.audit.actions.royalty_statement_closed"),
              value: "royalty_statement_closed",
            },
            {
              label: t("admin.audit.actions.royalty_statement_exported"),
              value: "royalty_statement_exported",
            },
            {
              label: t("admin.audit.actions.tenant_member_role_updated"),
              value: "tenant_member_role_updated",
            },
            {
              label: t("admin.audit.actions.tenant_member_removed"),
              value: "tenant_member_removed",
            },
            {
              label: t("admin.audit.actions.tenant_admin_invited"),
              value: "tenant_admin_invited",
            },
            {
              label: t("admin.audit.actions.tenant_admin_invite_resent"),
              value: "tenant_admin_invite_resent",
            },
            {
              label: t("admin.audit.actions.tenant_admin_invite_canceled"),
              value: "tenant_admin_invite_canceled",
            },
            {
              label: t("admin.audit.actions.tenant_admin_invite_accepted"),
              value: "tenant_admin_invite_accepted",
            },
            {
              label: t("admin.audit.actions.tenant_email_settings_updated"),
              value: "tenant_email_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_smtp_test_email_sent"),
              value: "tenant_smtp_test_email_sent",
            },
            {
              label: t("admin.audit.actions.tenant_payment_settings_updated"),
              value: "tenant_payment_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_fcm_credentials_saved"),
              value: "tenant_fcm_credentials_saved",
            },
            {
              label: t("admin.audit.actions.tenant_fcm_credentials_deleted"),
              value: "tenant_fcm_credentials_deleted",
            },
            {
              label: t("admin.audit.actions.tenant_community_limits_updated"),
              value: "tenant_community_limits_updated",
            },
            {
              label: t("admin.audit.actions.tenant_retention_updated"),
              value: "tenant_retention_updated",
            },
            {
              label: t("admin.audit.actions.admin_mfa_enrolled"),
              value: "admin_mfa_enrolled",
            },
            {
              label: t("admin.audit.actions.admin_mfa_verified"),
              value: "admin_mfa_verified",
            },
            {
              label: t("admin.audit.actions.admin_mfa_recovery_code_used"),
              value: "admin_mfa_recovery_code_used",
            },
            {
              label: t("admin.audit.actions.admin_mfa_disabled"),
              value: "admin_mfa_disabled",
            },
            {
              label: t(
                "admin.audit.actions.admin_mfa_recovery_codes_regenerated"
              ),
              value: "admin_mfa_recovery_codes_regenerated",
            },
          ]}
          name="action"
        />
      </FieldContent>
    </Field>
  );
};
