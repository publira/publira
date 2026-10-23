"use client";

import * as Field from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";

import { useClientMessages } from "#components/client-message";

interface AuditActionSelectProps {
  defaultValue: string;
}

export const AuditActionSelect = ({ defaultValue }: AuditActionSelectProps) => {
  const t = useClientMessages();

  return (
    <Field.Root>
      <Field.Label>{t("admin.audit.filter.action")}</Field.Label>
      <Field.Content>
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
              label: t("admin.audit.actions.series_campaign_prices_created"),
              value: "series_campaign_prices_created",
            },
            {
              label: t("admin.audit.actions.series_wait_free_settings_updated"),
              value: "series_wait_free_settings_updated",
            },
            {
              label: t("admin.audit.actions.series_translation_deleted"),
              value: "series_translation_deleted",
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
              label: t("admin.audit.actions.episode_translation_deleted"),
              value: "episode_translation_deleted",
            },
            {
              label: t("admin.audit.actions.episode_image_uploaded"),
              value: "episode_image_uploaded",
            },
            {
              label: t(
                "admin.audit.actions.episode_eye_catch_aspect_image_uploaded"
              ),
              value: "episode_eye_catch_aspect_image_uploaded",
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
              label: t("admin.audit.actions.episode_campaign_price_created"),
              value: "episode_campaign_price_created",
            },
            {
              label: t("admin.audit.actions.episode_campaign_price_deleted"),
              value: "episode_campaign_price_deleted",
            },
            {
              label: t("admin.audit.actions.volume_created"),
              value: "volume_created",
            },
            {
              label: t("admin.audit.actions.volume_updated"),
              value: "volume_updated",
            },
            {
              label: t("admin.audit.actions.volume_published"),
              value: "volume_published",
            },
            {
              label: t("admin.audit.actions.volume_unpublished"),
              value: "volume_unpublished",
            },
            {
              label: t("admin.audit.actions.volumes_reordered"),
              value: "volumes_reordered",
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
              label: t("admin.audit.actions.creator_account_linked"),
              value: "creator_account_linked",
            },
            {
              label: t("admin.audit.actions.creator_account_unlinked"),
              value: "creator_account_unlinked",
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
              label: t("admin.audit.actions.genre_translation_deleted"),
              value: "genre_translation_deleted",
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
              label: t("admin.audit.actions.page_translation_created"),
              value: "page_translation_created",
            },
            {
              label: t("admin.audit.actions.page_translation_deleted"),
              value: "page_translation_deleted",
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
              label: t("admin.audit.actions.campaign_banner_created"),
              value: "campaign_banner_created",
            },
            {
              label: t("admin.audit.actions.campaign_banner_updated"),
              value: "campaign_banner_updated",
            },
            {
              label: t("admin.audit.actions.campaign_banner_deleted"),
              value: "campaign_banner_deleted",
            },
            {
              label: t("admin.audit.actions.campaign_banners_reordered"),
              value: "campaign_banners_reordered",
            },
            {
              label: t(
                "admin.audit.actions.campaign_banner_aspect_image_uploaded"
              ),
              value: "campaign_banner_aspect_image_uploaded",
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
              label: t("admin.audit.actions.contact_message_assigned"),
              value: "contact_message_assigned",
            },
            {
              label: t("admin.audit.actions.contact_message_unassigned"),
              value: "contact_message_unassigned",
            },
            {
              label: t(
                "admin.audit.actions.contact_message_staff_note_updated"
              ),
              value: "contact_message_staff_note_updated",
            },
            {
              label: t("admin.audit.actions.contact_message_replied"),
              value: "contact_message_replied",
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
              label: t("admin.audit.actions.reader_icon_removed"),
              value: "reader_icon_removed",
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
              label: t("admin.audit.actions.purchase_refund_requested"),
              value: "purchase_refund_requested",
            },
            {
              label: t("admin.audit.actions.purchase_refunded"),
              value: "purchase_refunded",
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
              label: t("admin.audit.actions.tenant_member_added"),
              value: "tenant_member_added",
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
              label: t("admin.audit.actions.tenant_site_copy_updated"),
              value: "tenant_site_copy_updated",
            },
            {
              label: t("admin.audit.actions.tenant_timezone_updated"),
              value: "tenant_timezone_updated",
            },
            {
              label: t("admin.audit.actions.tenant_default_locale_updated"),
              value: "tenant_default_locale_updated",
            },
            {
              label: t("admin.audit.actions.tenant_comment_settings_updated"),
              value: "tenant_comment_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_age_verification_updated"),
              value: "tenant_age_verification_updated",
            },
            {
              label: t("admin.audit.actions.tenant_reader_icon_policy_updated"),
              value: "tenant_reader_icon_policy_updated",
            },
            {
              label: t(
                "admin.audit.actions.tenant_reader_icon_preset_uploaded"
              ),
              value: "tenant_reader_icon_preset_uploaded",
            },
            {
              label: t("admin.audit.actions.tenant_reader_icon_preset_deleted"),
              value: "tenant_reader_icon_preset_deleted",
            },
            {
              label: t("admin.audit.actions.tenant_legal_pages_updated"),
              value: "tenant_legal_pages_updated",
            },
            {
              label: t("admin.audit.actions.tenant_theme_updated"),
              value: "tenant_theme_updated",
            },
            {
              label: t("admin.audit.actions.tenant_logo_uploaded"),
              value: "tenant_logo_uploaded",
            },
            {
              label: t("admin.audit.actions.tenant_logo_deleted"),
              value: "tenant_logo_deleted",
            },
            {
              label: t("admin.audit.actions.tenant_icon_uploaded"),
              value: "tenant_icon_uploaded",
            },
            {
              label: t("admin.audit.actions.tenant_icon_deleted"),
              value: "tenant_icon_deleted",
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
              label: t(
                "admin.audit.actions.tenant_inbound_email_settings_updated"
              ),
              value: "tenant_inbound_email_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_payment_settings_updated"),
              value: "tenant_payment_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_purchase_settings_updated"),
              value: "tenant_purchase_settings_updated",
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
              label: t(
                "admin.audit.actions.tenant_mobile_app_association_updated"
              ),
              value: "tenant_mobile_app_association_updated",
            },
            {
              label: t("admin.audit.actions.tenant_sign_in_settings_updated"),
              value: "tenant_sign_in_settings_updated",
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
              label: t(
                "admin.audit.actions.tenant_email_rejection_settings_updated"
              ),
              value: "tenant_email_rejection_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_analytics_settings_updated"),
              value: "tenant_analytics_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_crawler_settings_updated"),
              value: "tenant_crawler_settings_updated",
            },
            {
              label: t("admin.audit.actions.tenant_sign_up_settings_updated"),
              value: "tenant_sign_up_settings_updated",
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
            {
              label: t("admin.audit.actions.admin_mfa_passkey_registered"),
              value: "admin_mfa_passkey_registered",
            },
            {
              label: t("admin.audit.actions.admin_mfa_passkey_renamed"),
              value: "admin_mfa_passkey_renamed",
            },
            {
              label: t("admin.audit.actions.admin_mfa_passkey_removed"),
              value: "admin_mfa_passkey_removed",
            },
          ]}
          name="action"
        />
      </Field.Content>
    </Field.Root>
  );
};
