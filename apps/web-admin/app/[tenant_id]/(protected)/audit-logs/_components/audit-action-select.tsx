"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useId } from "react";

import { useClientMessages } from "#components/client-message";

interface AuditActionSelectProps {
  defaultValue: string;
}

export const AuditActionSelect = ({ defaultValue }: AuditActionSelectProps) => {
  const t = useClientMessages();
  // Native <select> is not a Field control, so the label needs an id to point at.
  const actionSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={actionSelectId}>
        {t("admin.audit.filter.action")}
      </FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm text-foreground"
          defaultValue={defaultValue}
          id={actionSelectId}
          name="action"
        >
          <option value="">{t("admin.audit.actions.all")}</option>
          <option value="series_created">
            {t("admin.audit.actions.series_created")}
          </option>
          <option value="series_updated">
            {t("admin.audit.actions.series_updated")}
          </option>
          <option value="series_eye_catch_aspect_image_uploaded">
            {t("admin.audit.actions.series_eye_catch_aspect_image_uploaded")}
          </option>
          <option value="series_free_windows_created">
            {t("admin.audit.actions.series_free_windows_created")}
          </option>
          <option value="episode_created">
            {t("admin.audit.actions.episode_created")}
          </option>
          <option value="episode_updated">
            {t("admin.audit.actions.episode_updated")}
          </option>
          <option value="episode_image_uploaded">
            {t("admin.audit.actions.episode_image_uploaded")}
          </option>
          <option value="episode_credits_replaced">
            {t("admin.audit.actions.episode_credits_replaced")}
          </option>
          <option value="episode_credits_bulk_edited">
            {t("admin.audit.actions.episode_credits_bulk_edited")}
          </option>
          <option value="episode_free_window_created">
            {t("admin.audit.actions.episode_free_window_created")}
          </option>
          <option value="episode_free_window_deleted">
            {t("admin.audit.actions.episode_free_window_deleted")}
          </option>
          <option value="creator_created">
            {t("admin.audit.actions.creator_created")}
          </option>
          <option value="creator_updated">
            {t("admin.audit.actions.creator_updated")}
          </option>
          <option value="creator_role_created">
            {t("admin.audit.actions.creator_role_created")}
          </option>
          <option value="creator_role_updated">
            {t("admin.audit.actions.creator_role_updated")}
          </option>
          <option value="creator_role_deleted">
            {t("admin.audit.actions.creator_role_deleted")}
          </option>
          <option value="creator_roles_reordered">
            {t("admin.audit.actions.creator_roles_reordered")}
          </option>
          <option value="label_created">
            {t("admin.audit.actions.label_created")}
          </option>
          <option value="label_updated">
            {t("admin.audit.actions.label_updated")}
          </option>
          <option value="label_eye_catch_aspect_image_uploaded">
            {t("admin.audit.actions.label_eye_catch_aspect_image_uploaded")}
          </option>
          <option value="genre_created">
            {t("admin.audit.actions.genre_created")}
          </option>
          <option value="genre_updated">
            {t("admin.audit.actions.genre_updated")}
          </option>
          <option value="genre_deleted">
            {t("admin.audit.actions.genre_deleted")}
          </option>
          <option value="genres_reordered">
            {t("admin.audit.actions.genres_reordered")}
          </option>
          <option value="page_created">
            {t("admin.audit.actions.page_created")}
          </option>
          <option value="page_updated">
            {t("admin.audit.actions.page_updated")}
          </option>
          <option value="page_unpublished">
            {t("admin.audit.actions.page_unpublished")}
          </option>
          <option value="page_version_created">
            {t("admin.audit.actions.page_version_created")}
          </option>
          <option value="page_version_published">
            {t("admin.audit.actions.page_version_published")}
          </option>
          <option value="page_version_rolled_back">
            {t("admin.audit.actions.page_version_rolled_back")}
          </option>
          <option value="announcement_created">
            {t("admin.audit.actions.announcement_created")}
          </option>
          <option value="announcement_unpinned">
            {t("admin.audit.actions.announcement_unpinned")}
          </option>
          <option value="comment_approved">
            {t("admin.audit.actions.comment_approved")}
          </option>
          <option value="comment_hidden">
            {t("admin.audit.actions.comment_hidden")}
          </option>
          <option value="comment_auto_hidden">
            {t("admin.audit.actions.comment_auto_hidden")}
          </option>
          <option value="comment_restored">
            {t("admin.audit.actions.comment_restored")}
          </option>
          <option value="comment_purged">
            {t("admin.audit.actions.comment_purged")}
          </option>
          <option value="comment_report_resolved">
            {t("admin.audit.actions.comment_report_resolved")}
          </option>
          <option value="comment_report_rejected">
            {t("admin.audit.actions.comment_report_rejected")}
          </option>
          <option value="contact_message_handled">
            {t("admin.audit.actions.contact_message_handled")}
          </option>
          <option value="contact_message_reopened">
            {t("admin.audit.actions.contact_message_reopened")}
          </option>
          <option value="reader_suspended">
            {t("admin.audit.actions.reader_suspended")}
          </option>
          <option value="reader_unsuspended">
            {t("admin.audit.actions.reader_unsuspended")}
          </option>
          <option value="reader_birth_date_changed">
            {t("admin.audit.actions.reader_birth_date_changed")}
          </option>
          <option value="reader_birth_date_cleared">
            {t("admin.audit.actions.reader_birth_date_cleared")}
          </option>
          <option value="reader_deleted">
            {t("admin.audit.actions.reader_deleted")}
          </option>
          <option value="access_ticket_issued">
            {t("admin.audit.actions.access_ticket_issued")}
          </option>
          <option value="access_ticket_revoked">
            {t("admin.audit.actions.access_ticket_revoked")}
          </option>
          <option value="royalty_config_updated">
            {t("admin.audit.actions.royalty_config_updated")}
          </option>
          <option value="royalty_statement_closed">
            {t("admin.audit.actions.royalty_statement_closed")}
          </option>
          <option value="royalty_statement_exported">
            {t("admin.audit.actions.royalty_statement_exported")}
          </option>
          <option value="tenant_member_role_updated">
            {t("admin.audit.actions.tenant_member_role_updated")}
          </option>
          <option value="tenant_member_removed">
            {t("admin.audit.actions.tenant_member_removed")}
          </option>
          <option value="tenant_admin_invited">
            {t("admin.audit.actions.tenant_admin_invited")}
          </option>
          <option value="tenant_admin_invite_resent">
            {t("admin.audit.actions.tenant_admin_invite_resent")}
          </option>
          <option value="tenant_admin_invite_canceled">
            {t("admin.audit.actions.tenant_admin_invite_canceled")}
          </option>
          <option value="tenant_admin_invite_accepted">
            {t("admin.audit.actions.tenant_admin_invite_accepted")}
          </option>
          <option value="tenant_email_settings_updated">
            {t("admin.audit.actions.tenant_email_settings_updated")}
          </option>
          <option value="tenant_smtp_test_email_sent">
            {t("admin.audit.actions.tenant_smtp_test_email_sent")}
          </option>
          <option value="tenant_payment_settings_updated">
            {t("admin.audit.actions.tenant_payment_settings_updated")}
          </option>
          <option value="tenant_fcm_credentials_saved">
            {t("admin.audit.actions.tenant_fcm_credentials_saved")}
          </option>
          <option value="tenant_fcm_credentials_deleted">
            {t("admin.audit.actions.tenant_fcm_credentials_deleted")}
          </option>
          <option value="tenant_community_limits_updated">
            {t("admin.audit.actions.tenant_community_limits_updated")}
          </option>
          <option value="tenant_retention_updated">
            {t("admin.audit.actions.tenant_retention_updated")}
          </option>
          <option value="admin_mfa_enrolled">
            {t("admin.audit.actions.admin_mfa_enrolled")}
          </option>
          <option value="admin_mfa_verified">
            {t("admin.audit.actions.admin_mfa_verified")}
          </option>
          <option value="admin_mfa_recovery_code_used">
            {t("admin.audit.actions.admin_mfa_recovery_code_used")}
          </option>
          <option value="admin_mfa_disabled">
            {t("admin.audit.actions.admin_mfa_disabled")}
          </option>
          <option value="admin_mfa_recovery_codes_regenerated">
            {t("admin.audit.actions.admin_mfa_recovery_codes_regenerated")}
          </option>
        </select>
      </FieldContent>
    </Field>
  );
};
