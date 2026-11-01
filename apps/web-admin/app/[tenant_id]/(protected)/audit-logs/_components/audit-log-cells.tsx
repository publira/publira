import { smtpTestFailureMessage } from "@publira/api-client/error-messages";
import { getLocaleLabel, isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { formatTenantAmount } from "#lib/price";
import { getTenantRoleLabel } from "#lib/role-labels";

/** An action on series or episodes. */
const catalogActionName = (action: string) => {
  switch (action) {
    case "series_created": {
      return <Message message="admin.audit.actions.series_created" />;
    }

    case "series_updated": {
      return <Message message="admin.audit.actions.series_updated" />;
    }

    case "series_eye_catch_aspect_image_uploaded": {
      return (
        <Message message="admin.audit.actions.series_eye_catch_aspect_image_uploaded" />
      );
    }

    case "series_free_windows_created": {
      return (
        <Message message="admin.audit.actions.series_free_windows_created" />
      );
    }

    case "series_campaign_prices_created": {
      return (
        <Message message="admin.audit.actions.series_campaign_prices_created" />
      );
    }

    case "series_wait_free_settings_updated": {
      return (
        <Message message="admin.audit.actions.series_wait_free_settings_updated" />
      );
    }

    case "series_free_after_settings_updated": {
      return (
        <Message message="admin.audit.actions.series_free_after_settings_updated" />
      );
    }

    case "series_translation_deleted": {
      return (
        <Message message="admin.audit.actions.series_translation_deleted" />
      );
    }

    case "episode_created": {
      return <Message message="admin.audit.actions.episode_created" />;
    }

    case "episode_updated": {
      return <Message message="admin.audit.actions.episode_updated" />;
    }

    case "episode_translation_deleted": {
      return (
        <Message message="admin.audit.actions.episode_translation_deleted" />
      );
    }

    case "episode_image_uploaded": {
      return <Message message="admin.audit.actions.episode_image_uploaded" />;
    }

    case "episode_eye_catch_aspect_image_uploaded": {
      return (
        <Message message="admin.audit.actions.episode_eye_catch_aspect_image_uploaded" />
      );
    }

    case "episode_credits_replaced": {
      return <Message message="admin.audit.actions.episode_credits_replaced" />;
    }

    case "episode_credits_bulk_edited": {
      return (
        <Message message="admin.audit.actions.episode_credits_bulk_edited" />
      );
    }

    case "episode_free_window_created": {
      return (
        <Message message="admin.audit.actions.episode_free_window_created" />
      );
    }

    case "episode_free_window_deleted": {
      return (
        <Message message="admin.audit.actions.episode_free_window_deleted" />
      );
    }

    case "episode_campaign_price_created": {
      return (
        <Message message="admin.audit.actions.episode_campaign_price_created" />
      );
    }

    case "episode_campaign_price_deleted": {
      return (
        <Message message="admin.audit.actions.episode_campaign_price_deleted" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on volumes. */
const volumeActionName = (action: string) => {
  switch (action) {
    case "volume_created": {
      return <Message message="admin.audit.actions.volume_created" />;
    }

    case "volume_updated": {
      return <Message message="admin.audit.actions.volume_updated" />;
    }

    case "volume_published": {
      return <Message message="admin.audit.actions.volume_published" />;
    }

    case "volume_unpublished": {
      return <Message message="admin.audit.actions.volume_unpublished" />;
    }

    case "volumes_reordered": {
      return <Message message="admin.audit.actions.volumes_reordered" />;
    }

    default: {
      return null;
    }
  }
};

/** An action on authors, author roles, labels, or genres. */
const taxonomyActionName = (action: string) => {
  switch (action) {
    case "creator_created": {
      return <Message message="admin.audit.actions.creator_created" />;
    }

    case "creator_updated": {
      return <Message message="admin.audit.actions.creator_updated" />;
    }

    case "creator_account_linked": {
      return <Message message="admin.audit.actions.creator_account_linked" />;
    }

    case "creator_account_unlinked": {
      return <Message message="admin.audit.actions.creator_account_unlinked" />;
    }

    case "creator_role_created": {
      return <Message message="admin.audit.actions.creator_role_created" />;
    }

    case "creator_role_updated": {
      return <Message message="admin.audit.actions.creator_role_updated" />;
    }

    case "creator_role_deleted": {
      return <Message message="admin.audit.actions.creator_role_deleted" />;
    }

    case "creator_roles_reordered": {
      return <Message message="admin.audit.actions.creator_roles_reordered" />;
    }

    case "label_created": {
      return <Message message="admin.audit.actions.label_created" />;
    }

    case "label_updated": {
      return <Message message="admin.audit.actions.label_updated" />;
    }

    case "label_eye_catch_aspect_image_uploaded": {
      return (
        <Message message="admin.audit.actions.label_eye_catch_aspect_image_uploaded" />
      );
    }

    case "genre_created": {
      return <Message message="admin.audit.actions.genre_created" />;
    }

    case "genre_updated": {
      return <Message message="admin.audit.actions.genre_updated" />;
    }

    case "genre_deleted": {
      return <Message message="admin.audit.actions.genre_deleted" />;
    }

    case "genre_translation_deleted": {
      return (
        <Message message="admin.audit.actions.genre_translation_deleted" />
      );
    }

    case "genres_reordered": {
      return <Message message="admin.audit.actions.genres_reordered" />;
    }

    case "genre_eye_catch_aspect_image_uploaded": {
      return (
        <Message message="admin.audit.actions.genre_eye_catch_aspect_image_uploaded" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on pages, announcements, or comments. */
const siteActionName = (action: string) => {
  switch (action) {
    case "page_created": {
      return <Message message="admin.audit.actions.page_created" />;
    }

    case "page_updated": {
      return <Message message="admin.audit.actions.page_updated" />;
    }

    case "page_unpublished": {
      return <Message message="admin.audit.actions.page_unpublished" />;
    }

    case "page_version_created": {
      return <Message message="admin.audit.actions.page_version_created" />;
    }

    case "page_version_published": {
      return <Message message="admin.audit.actions.page_version_published" />;
    }

    case "page_version_rolled_back": {
      return <Message message="admin.audit.actions.page_version_rolled_back" />;
    }

    case "page_translation_created": {
      return <Message message="admin.audit.actions.page_translation_created" />;
    }

    case "page_translation_deleted": {
      return <Message message="admin.audit.actions.page_translation_deleted" />;
    }

    case "announcement_created": {
      return <Message message="admin.audit.actions.announcement_created" />;
    }

    case "announcement_unpinned": {
      return <Message message="admin.audit.actions.announcement_unpinned" />;
    }

    case "comment_approved": {
      return <Message message="admin.audit.actions.comment_approved" />;
    }

    case "comment_hidden": {
      return <Message message="admin.audit.actions.comment_hidden" />;
    }

    case "comment_auto_hidden": {
      return <Message message="admin.audit.actions.comment_auto_hidden" />;
    }

    case "comment_restored": {
      return <Message message="admin.audit.actions.comment_restored" />;
    }

    case "comment_purged": {
      return <Message message="admin.audit.actions.comment_purged" />;
    }

    case "comment_report_resolved": {
      return <Message message="admin.audit.actions.comment_report_resolved" />;
    }

    case "comment_report_rejected": {
      return <Message message="admin.audit.actions.comment_report_rejected" />;
    }

    default: {
      return null;
    }
  }
};

/** An action on campaign banners. */
const campaignBannerActionName = (action: string) => {
  switch (action) {
    case "campaign_banner_created": {
      return <Message message="admin.audit.actions.campaign_banner_created" />;
    }

    case "campaign_banner_updated": {
      return <Message message="admin.audit.actions.campaign_banner_updated" />;
    }

    case "campaign_banner_deleted": {
      return <Message message="admin.audit.actions.campaign_banner_deleted" />;
    }

    case "campaign_banners_reordered": {
      return (
        <Message message="admin.audit.actions.campaign_banners_reordered" />
      );
    }

    case "campaign_banner_aspect_image_uploaded": {
      return (
        <Message message="admin.audit.actions.campaign_banner_aspect_image_uploaded" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on contact messages. */
const contactMessageActionName = (action: string) => {
  switch (action) {
    case "contact_message_handled": {
      return <Message message="admin.audit.actions.contact_message_handled" />;
    }

    case "contact_message_reopened": {
      return <Message message="admin.audit.actions.contact_message_reopened" />;
    }

    case "contact_message_assigned": {
      return <Message message="admin.audit.actions.contact_message_assigned" />;
    }

    case "contact_message_unassigned": {
      return (
        <Message message="admin.audit.actions.contact_message_unassigned" />
      );
    }

    case "contact_message_staff_note_updated": {
      return (
        <Message message="admin.audit.actions.contact_message_staff_note_updated" />
      );
    }

    case "contact_message_replied": {
      return <Message message="admin.audit.actions.contact_message_replied" />;
    }

    default: {
      return null;
    }
  }
};

/**
 * A staff refund of a reader's purchase: the request, and what the provider
 * did about it.
 */
const purchaseActionName = (action: string) => {
  switch (action) {
    case "purchase_refund_requested": {
      return (
        <Message message="admin.audit.actions.purchase_refund_requested" />
      );
    }

    case "purchase_refunded": {
      return <Message message="admin.audit.actions.purchase_refunded" />;
    }

    default: {
      return null;
    }
  }
};

/** An action on subscription plans. */
const subscriptionPlanActionName = (action: string) => {
  switch (action) {
    case "subscription_plan_created": {
      return (
        <Message message="admin.audit.actions.subscription_plan_created" />
      );
    }

    case "subscription_plan_updated": {
      return (
        <Message message="admin.audit.actions.subscription_plan_updated" />
      );
    }

    case "subscription_plan_deleted": {
      return (
        <Message message="admin.audit.actions.subscription_plan_deleted" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on the tenant's coin settings or its coin packs. */
const coinActionName = (action: string) => {
  switch (action) {
    case "coin_settings_updated": {
      return <Message message="admin.audit.actions.coin_settings_updated" />;
    }

    case "coin_pack_created": {
      return <Message message="admin.audit.actions.coin_pack_created" />;
    }

    case "coin_pack_updated": {
      return <Message message="admin.audit.actions.coin_pack_updated" />;
    }

    case "coin_pack_retired": {
      return <Message message="admin.audit.actions.coin_pack_retired" />;
    }

    default: {
      return null;
    }
  }
};

/** A CSV download: a royalty statement, an analytics report, or the log. */
const exportActionName = (action: string) => {
  switch (action) {
    case "royalty_statement_exported": {
      return (
        <Message message="admin.audit.actions.royalty_statement_exported" />
      );
    }

    case "stats_exported": {
      return <Message message="admin.audit.actions.stats_exported" />;
    }

    case "audit_log_exported": {
      return <Message message="admin.audit.actions.audit_log_exported" />;
    }

    default: {
      return null;
    }
  }
};

/** An action on readers, access tickets, royalties, or members. */
const readerActionName = (action: string) => {
  switch (action) {
    case "reader_suspended": {
      return <Message message="admin.audit.actions.reader_suspended" />;
    }

    case "reader_unsuspended": {
      return <Message message="admin.audit.actions.reader_unsuspended" />;
    }

    case "reader_birth_date_changed": {
      return (
        <Message message="admin.audit.actions.reader_birth_date_changed" />
      );
    }

    case "reader_birth_date_cleared": {
      return (
        <Message message="admin.audit.actions.reader_birth_date_cleared" />
      );
    }

    case "reader_icon_removed": {
      return <Message message="admin.audit.actions.reader_icon_removed" />;
    }

    case "reader_deleted": {
      return <Message message="admin.audit.actions.reader_deleted" />;
    }

    case "access_ticket_issued": {
      return <Message message="admin.audit.actions.access_ticket_issued" />;
    }

    case "access_ticket_revoked": {
      return <Message message="admin.audit.actions.access_ticket_revoked" />;
    }

    case "royalty_config_updated": {
      return <Message message="admin.audit.actions.royalty_config_updated" />;
    }

    case "royalty_statement_closed": {
      return <Message message="admin.audit.actions.royalty_statement_closed" />;
    }

    case "tenant_member_added": {
      return <Message message="admin.audit.actions.tenant_member_added" />;
    }

    case "tenant_member_role_updated": {
      return (
        <Message message="admin.audit.actions.tenant_member_role_updated" />
      );
    }

    case "tenant_member_removed": {
      return <Message message="admin.audit.actions.tenant_member_removed" />;
    }

    case "tenant_admin_invited": {
      return <Message message="admin.audit.actions.tenant_admin_invited" />;
    }

    case "tenant_admin_invite_resent": {
      return (
        <Message message="admin.audit.actions.tenant_admin_invite_resent" />
      );
    }

    case "tenant_admin_invite_canceled": {
      return (
        <Message message="admin.audit.actions.tenant_admin_invite_canceled" />
      );
    }

    case "tenant_admin_invite_accepted": {
      return (
        <Message message="admin.audit.actions.tenant_admin_invite_accepted" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on the tenant's settings. */
const settingsActionName = (action: string) => {
  switch (action) {
    case "tenant_site_copy_updated": {
      return <Message message="admin.audit.actions.tenant_site_copy_updated" />;
    }

    case "tenant_timezone_updated": {
      return <Message message="admin.audit.actions.tenant_timezone_updated" />;
    }

    case "tenant_default_locale_updated": {
      return (
        <Message message="admin.audit.actions.tenant_default_locale_updated" />
      );
    }

    case "tenant_comment_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_comment_settings_updated" />
      );
    }

    case "tenant_creator_page_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_creator_page_settings_updated" />
      );
    }

    case "tenant_age_verification_updated": {
      return (
        <Message message="admin.audit.actions.tenant_age_verification_updated" />
      );
    }

    case "tenant_reader_icon_policy_updated": {
      return (
        <Message message="admin.audit.actions.tenant_reader_icon_policy_updated" />
      );
    }

    case "tenant_reader_icon_preset_uploaded": {
      return (
        <Message message="admin.audit.actions.tenant_reader_icon_preset_uploaded" />
      );
    }

    case "tenant_reader_icon_preset_deleted": {
      return (
        <Message message="admin.audit.actions.tenant_reader_icon_preset_deleted" />
      );
    }

    case "tenant_legal_pages_updated": {
      return (
        <Message message="admin.audit.actions.tenant_legal_pages_updated" />
      );
    }

    case "tenant_community_limits_updated": {
      return (
        <Message message="admin.audit.actions.tenant_community_limits_updated" />
      );
    }

    case "tenant_retention_updated": {
      return <Message message="admin.audit.actions.tenant_retention_updated" />;
    }

    case "tenant_email_rejection_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_email_rejection_settings_updated" />
      );
    }

    case "tenant_analytics_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_analytics_settings_updated" />
      );
    }

    case "tenant_crawler_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_crawler_settings_updated" />
      );
    }

    case "tenant_sign_up_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_sign_up_settings_updated" />
      );
    }

    case "tenant_site_verification_updated": {
      return (
        <Message message="admin.audit.actions.tenant_site_verification_updated" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on the tenant's branding. */
const brandingActionName = (action: string) => {
  switch (action) {
    case "tenant_theme_updated": {
      return <Message message="admin.audit.actions.tenant_theme_updated" />;
    }

    case "tenant_dark_theme_updated": {
      return (
        <Message message="admin.audit.actions.tenant_dark_theme_updated" />
      );
    }

    case "tenant_dark_theme_deleted": {
      return (
        <Message message="admin.audit.actions.tenant_dark_theme_deleted" />
      );
    }

    case "tenant_logo_uploaded": {
      return <Message message="admin.audit.actions.tenant_logo_uploaded" />;
    }

    case "tenant_logo_deleted": {
      return <Message message="admin.audit.actions.tenant_logo_deleted" />;
    }

    case "tenant_icon_uploaded": {
      return <Message message="admin.audit.actions.tenant_icon_uploaded" />;
    }

    case "tenant_icon_deleted": {
      return <Message message="admin.audit.actions.tenant_icon_deleted" />;
    }

    case "tenant_sign_in_image_uploaded": {
      return (
        <Message message="admin.audit.actions.tenant_sign_in_image_uploaded" />
      );
    }

    case "tenant_sign_in_image_deleted": {
      return (
        <Message message="admin.audit.actions.tenant_sign_in_image_deleted" />
      );
    }

    case "tenant_brand_mark_uploaded": {
      return (
        <Message message="admin.audit.actions.tenant_brand_mark_uploaded" />
      );
    }

    case "tenant_brand_mark_deleted": {
      return (
        <Message message="admin.audit.actions.tenant_brand_mark_deleted" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on one of the tenant's integrations. */
const integrationActionName = (action: string) => {
  switch (action) {
    case "tenant_email_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_email_settings_updated" />
      );
    }

    case "tenant_smtp_test_email_sent": {
      return (
        <Message message="admin.audit.actions.tenant_smtp_test_email_sent" />
      );
    }

    case "tenant_inbound_email_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_inbound_email_settings_updated" />
      );
    }

    case "tenant_payment_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_payment_settings_updated" />
      );
    }

    case "tenant_purchase_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_purchase_settings_updated" />
      );
    }

    case "tenant_fcm_credentials_saved": {
      return (
        <Message message="admin.audit.actions.tenant_fcm_credentials_saved" />
      );
    }

    case "tenant_fcm_credentials_deleted": {
      return (
        <Message message="admin.audit.actions.tenant_fcm_credentials_deleted" />
      );
    }

    case "tenant_mobile_app_association_updated": {
      return (
        <Message message="admin.audit.actions.tenant_mobile_app_association_updated" />
      );
    }

    case "tenant_sign_in_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_sign_in_settings_updated" />
      );
    }

    default: {
      return null;
    }
  }
};

/** An action on a member's two-step verification. */
const mfaActionName = (action: string) => {
  switch (action) {
    case "admin_mfa_enrolled": {
      return <Message message="admin.audit.actions.admin_mfa_enrolled" />;
    }

    case "admin_mfa_verified": {
      return <Message message="admin.audit.actions.admin_mfa_verified" />;
    }

    case "admin_mfa_recovery_code_used": {
      return (
        <Message message="admin.audit.actions.admin_mfa_recovery_code_used" />
      );
    }

    case "admin_mfa_disabled": {
      return <Message message="admin.audit.actions.admin_mfa_disabled" />;
    }

    case "admin_mfa_recovery_codes_regenerated": {
      return (
        <Message message="admin.audit.actions.admin_mfa_recovery_codes_regenerated" />
      );
    }

    case "admin_mfa_passkey_registered": {
      return (
        <Message message="admin.audit.actions.admin_mfa_passkey_registered" />
      );
    }

    case "admin_mfa_passkey_renamed": {
      return (
        <Message message="admin.audit.actions.admin_mfa_passkey_renamed" />
      );
    }

    case "admin_mfa_passkey_removed": {
      return (
        <Message message="admin.audit.actions.admin_mfa_passkey_removed" />
      );
    }

    default: {
      return null;
    }
  }
};

/** The name of an action the admin API records, or `null` for any other. */
const actionName = (action: string) =>
  catalogActionName(action) ??
  volumeActionName(action) ??
  taxonomyActionName(action) ??
  siteActionName(action) ??
  campaignBannerActionName(action) ??
  contactMessageActionName(action) ??
  readerActionName(action) ??
  exportActionName(action) ??
  purchaseActionName(action) ??
  subscriptionPlanActionName(action) ??
  coinActionName(action) ??
  settingsActionName(action) ??
  brandingActionName(action) ??
  integrationActionName(action) ??
  mfaActionName(action);

/** The name of a catalog, community, or reader target type. */
const catalogTargetName = (targetType: string) => {
  switch (targetType) {
    case "access_ticket": {
      return <Message message="admin.audit.targets.access_ticket" />;
    }

    case "announcement": {
      return <Message message="admin.audit.targets.announcement" />;
    }

    case "campaign_banner": {
      return <Message message="admin.audit.targets.campaign_banner" />;
    }

    case "comment": {
      return <Message message="admin.audit.targets.comment" />;
    }

    case "contact_message": {
      return <Message message="admin.audit.targets.contact_message" />;
    }

    case "creator": {
      return <Message message="admin.audit.targets.creator" />;
    }

    case "creator_account": {
      return <Message message="admin.audit.targets.creator_account" />;
    }

    case "creator_role": {
      return <Message message="admin.audit.targets.creator_role" />;
    }

    case "episode": {
      return <Message message="admin.audit.targets.episode" />;
    }

    case "episode_campaign_price": {
      return <Message message="admin.audit.targets.episode_campaign_price" />;
    }

    case "episode_free_window": {
      return <Message message="admin.audit.targets.episode_free_window" />;
    }

    case "genre": {
      return <Message message="admin.audit.targets.genre" />;
    }

    case "label": {
      return <Message message="admin.audit.targets.label" />;
    }

    case "page": {
      return <Message message="admin.audit.targets.page" />;
    }

    case "page_version": {
      return <Message message="admin.audit.targets.page_version" />;
    }

    case "page_translation": {
      return <Message message="admin.audit.targets.page_translation" />;
    }

    case "purchase": {
      return <Message message="admin.audit.targets.purchase" />;
    }

    case "series": {
      return <Message message="admin.audit.targets.series" />;
    }

    case "volume": {
      return <Message message="admin.audit.targets.volume" />;
    }

    default: {
      return null;
    }
  }
};

/** The name of a tenant setting target type. */
const settingTargetName = (targetType: string) => {
  switch (targetType) {
    case "tenant_age_verification": {
      return <Message message="admin.audit.targets.tenant_age_verification" />;
    }

    case "tenant_analytics_settings": {
      return (
        <Message message="admin.audit.targets.tenant_analytics_settings" />
      );
    }

    case "tenant_branding": {
      return <Message message="admin.audit.targets.tenant_branding" />;
    }

    case "tenant_comment_settings": {
      return <Message message="admin.audit.targets.tenant_comment_settings" />;
    }

    case "tenant_community_limits": {
      return <Message message="admin.audit.targets.tenant_community_limits" />;
    }

    case "tenant_crawler_settings": {
      return <Message message="admin.audit.targets.tenant_crawler_settings" />;
    }

    case "tenant_creator_page_settings": {
      return (
        <Message message="admin.audit.targets.tenant_creator_page_settings" />
      );
    }

    case "tenant_default_locale": {
      return <Message message="admin.audit.targets.tenant_default_locale" />;
    }

    case "tenant_email_rejection_settings": {
      return (
        <Message message="admin.audit.targets.tenant_email_rejection_settings" />
      );
    }

    case "tenant_legal_pages": {
      return <Message message="admin.audit.targets.tenant_legal_pages" />;
    }

    case "tenant_mobile_app_association": {
      return (
        <Message message="admin.audit.targets.tenant_mobile_app_association" />
      );
    }

    case "tenant_purchase_settings": {
      return <Message message="admin.audit.targets.tenant_purchase_settings" />;
    }

    case "tenant_reader_icon_policy": {
      return (
        <Message message="admin.audit.targets.tenant_reader_icon_policy" />
      );
    }

    case "tenant_reader_icon_presets": {
      return (
        <Message message="admin.audit.targets.tenant_reader_icon_presets" />
      );
    }

    case "tenant_retention": {
      return <Message message="admin.audit.targets.tenant_retention" />;
    }

    case "tenant_sign_in_settings": {
      return <Message message="admin.audit.targets.tenant_sign_in_settings" />;
    }

    case "tenant_sign_up_settings": {
      return <Message message="admin.audit.targets.tenant_sign_up_settings" />;
    }

    case "tenant_site_copy": {
      return <Message message="admin.audit.targets.tenant_site_copy" />;
    }

    case "tenant_site_verification": {
      return <Message message="admin.audit.targets.tenant_site_verification" />;
    }

    case "tenant_timezone": {
      return <Message message="admin.audit.targets.tenant_timezone" />;
    }

    default: {
      return null;
    }
  }
};

/**
 * The name of an integration, subscription plan, coin, royalty, analytics,
 * audit log, or account target type.
 */
const tenantTargetName = (targetType: string) => {
  switch (targetType) {
    case "audience_stats": {
      return <Message message="admin.audit.targets.audience_stats" />;
    }

    case "audit_log": {
      return <Message message="admin.audit.targets.audit_log" />;
    }

    case "coin_pack": {
      return <Message message="admin.audit.targets.coin_pack" />;
    }

    case "coin_settings": {
      return <Message message="admin.audit.targets.coin_settings" />;
    }

    case "fcm_config": {
      return <Message message="admin.audit.targets.fcm_config" />;
    }

    case "inbound_email_config": {
      return <Message message="admin.audit.targets.inbound_email_config" />;
    }

    case "payment_config": {
      return <Message message="admin.audit.targets.payment_config" />;
    }

    case "revenue_stats": {
      return <Message message="admin.audit.targets.revenue_stats" />;
    }

    case "royalty_config": {
      return <Message message="admin.audit.targets.royalty_config" />;
    }

    case "royalty_statement": {
      return <Message message="admin.audit.targets.royalty_statement" />;
    }

    case "smtp_config": {
      return <Message message="admin.audit.targets.smtp_config" />;
    }

    case "subscription_plan": {
      return <Message message="admin.audit.targets.subscription_plan" />;
    }

    case "tenant_admin_invitation": {
      return <Message message="admin.audit.targets.tenant_admin_invitation" />;
    }

    case "user": {
      return <Message message="admin.audit.targets.user" />;
    }

    default: {
      return null;
    }
  }
};

/** The name of a target type the admin API records, or `null` for any other. */
const targetTypeName = (targetType: string) =>
  catalogTargetName(targetType) ??
  settingTargetName(targetType) ??
  tenantTargetName(targetType);

/**
 * What the entry's target ID reads as: the language's name for the public site
 * copy, which the server records per locale, and the ID itself for any other.
 */
const targetIdLabel = (targetType: string, targetId: string) =>
  targetType === "tenant_site_copy" && isLocale(targetId) ? (
    <span lang={targetId}>{getLocaleLabel(targetId)}</span>
  ) : (
    targetId
  );

const outcomeToneMap = {
  failure: "destructive",
  success: "success",
  unknown: "muted",
} as const;

type AuditOutcome = "failure" | "success" | "unknown";

interface AuditLogDateCellProps {
  createdAt: string;
  locale: Locale;
  timeZone: string;
}

interface AuditLogActorCellProps {
  actorName: string;
  actorRole: string;
  actorUserPublicId: string;
  locale: Locale;
}

interface AuditLogActionCellProps {
  action: string;
  locale: Locale;
  reason: string;
  targetId: string;
  targetType: string;
}

interface AuditLogOutcomeCellProps {
  locale: Locale;
  outcome: AuditOutcome;
}

// Who the posted announcement's notification was for.
const announcementDeliveryLabel = (reason: string, t: AdminMessageAccessor) => {
  switch (reason) {
    case "delivery=preferred": {
      return t("admin.audit.reasons.announcement_delivery.preferred");
    }

    case "delivery=everyone": {
      return t("admin.audit.reasons.announcement_delivery.everyone");
    }

    case "delivery=preferred;audience=targeted": {
      return t("admin.audit.reasons.announcement_delivery.targeted");
    }

    default: {
      return reason;
    }
  }
};

/**
 * The reason of a refund in part, which the server records as the amount in
 * the minor unit of its currency ahead of staff's own reason.
 */
const PURCHASE_REFUND_IN_PART_RE =
  /^amount=(?<amount>\d+) (?<currency>[A-Z]{3}); (?<reason>[\s\S]*)$/u;

// The amount of a refund in part, beside staff's reason; a refund of the whole
// records the reason alone.
const purchaseRefundLabel = (
  reason: string,
  locale: Locale,
  t: AdminMessageAccessor
) => {
  const groups = PURCHASE_REFUND_IN_PART_RE.exec(reason)?.groups;

  if (
    groups?.amount === undefined ||
    groups.currency === undefined ||
    groups.reason === undefined
  ) {
    return reason;
  }

  return t("admin.audit.reasons.purchase_refund_in_part", {
    amount: formatTenantAmount(Number(groups.amount), {
      currency: groups.currency,
      locale,
    }),
    reason: groups.reason,
  });
};

/**
 * The reason of an entry as the console shows it: the words for a value the
 * server records in a fixed form, and the reason as written otherwise.
 */
const auditReasonLabel = (
  action: string,
  reason: string,
  locale: Locale,
  t: AdminMessageAccessor
) => {
  switch (action) {
    case "tenant_smtp_test_email_sent": {
      return smtpTestFailureMessage(reason, locale) ?? reason;
    }

    case "announcement_created": {
      return announcementDeliveryLabel(reason, t);
    }

    case "purchase_refund_requested":
    case "purchase_refunded": {
      return purchaseRefundLabel(reason, locale, t);
    }

    default: {
      return reason;
    }
  }
};

export const AuditLogDateCell = ({
  createdAt,
  locale,
  timeZone,
}: AuditLogDateCellProps) => (
  <Table.Cell className="text-sm text-muted-foreground">
    {formatDateTime(createdAt, { fallback: "-", locale, timeZone })}
  </Table.Cell>
);

export const AuditLogActorCell = async ({
  actorName,
  actorRole,
  actorUserPublicId,
  locale,
}: AuditLogActorCellProps) => {
  const t = await getMessagesFor(locale);

  return (
    <Table.Cell>
      <div className="font-medium">
        {actorName || t("admin.audit.actor_unnamed")}
      </div>
      <div className="text-xs text-muted-foreground">
        {actorUserPublicId || t("admin.audit.actor_id_unknown")}
        {actorRole ? ` / ${await getTenantRoleLabel(actorRole, locale)}` : ""}
      </div>
    </Table.Cell>
  );
};

export const AuditLogActionCell = async ({
  action,
  locale,
  reason,
  targetId,
  targetType,
}: AuditLogActionCellProps) => {
  const t = await getMessagesFor(locale);
  const targetName = targetTypeName(targetType);
  const reasonLabel = auditReasonLabel(action, reason, locale, t);

  return (
    <Table.Cell>
      <div className="font-medium">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          {actionName(action) ?? (
            <Message message="admin.audit.actions.other" />
          )}
        </Suspense>
      </div>
      {(targetType || targetId || reasonLabel) && (
        <div className="text-xs text-muted-foreground">
          {targetName ? (
            <Suspense fallback={<SkeletonLine className="h-3 w-20" />}>
              {targetName}
            </Suspense>
          ) : (
            targetType || t("admin.audit.target_type_none")
          )}
          {targetId ? (
            <>
              {" / "}
              {targetIdLabel(targetType, targetId)}
            </>
          ) : (
            ""
          )}
          {reasonLabel ? ` / ${reasonLabel}` : ""}
        </div>
      )}
    </Table.Cell>
  );
};

export const AuditLogOutcomeCell = async ({
  locale,
  outcome,
}: AuditLogOutcomeCellProps) => {
  const t = await getMessagesFor(locale);

  return (
    <Table.Cell>
      <Badge tone={outcomeToneMap[outcome]}>
        {outcome === "failure" && t("admin.audit.outcome.failure")}
        {outcome === "success" && t("admin.audit.outcome.success")}
        {outcome === "unknown" && t("admin.audit.outcome.unknown")}
      </Badge>
    </Table.Cell>
  );
};
