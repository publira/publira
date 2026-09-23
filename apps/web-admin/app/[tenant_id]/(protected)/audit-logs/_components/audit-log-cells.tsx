import { smtpTestFailureMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { TableCell } from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { AdminMessageKey } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
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
    case "episode_created": {
      return <Message message="admin.audit.actions.episode_created" />;
    }
    case "episode_updated": {
      return <Message message="admin.audit.actions.episode_updated" />;
    }
    case "episode_image_uploaded": {
      return <Message message="admin.audit.actions.episode_image_uploaded" />;
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
    case "genres_reordered": {
      return <Message message="admin.audit.actions.genres_reordered" />;
    }
    default: {
      return null;
    }
  }
};

/** An action on pages, announcements, comments, or contact messages. */
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
    case "contact_message_handled": {
      return <Message message="admin.audit.actions.contact_message_handled" />;
    }
    case "contact_message_reopened": {
      return <Message message="admin.audit.actions.contact_message_reopened" />;
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
    case "royalty_statement_exported": {
      return (
        <Message message="admin.audit.actions.royalty_statement_exported" />
      );
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

/** An action on tenant settings or two-step verification. */
const settingsActionName = (action: string) => {
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
    case "tenant_payment_settings_updated": {
      return (
        <Message message="admin.audit.actions.tenant_payment_settings_updated" />
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
    case "tenant_community_limits_updated": {
      return (
        <Message message="admin.audit.actions.tenant_community_limits_updated" />
      );
    }
    case "tenant_retention_updated": {
      return <Message message="admin.audit.actions.tenant_retention_updated" />;
    }
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
    default: {
      return null;
    }
  }
};

/** The name of an action the admin API records, or `null` for any other. */
const actionName = (action: string) =>
  catalogActionName(action) ??
  taxonomyActionName(action) ??
  siteActionName(action) ??
  readerActionName(action) ??
  settingsActionName(action);

/** The name of a catalog, community, or reader target type. */
const catalogTargetName = (targetType: string) => {
  switch (targetType) {
    case "access_ticket": {
      return <Message message="admin.audit.targets.access_ticket" />;
    }
    case "announcement": {
      return <Message message="admin.audit.targets.announcement" />;
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
    case "creator_role": {
      return <Message message="admin.audit.targets.creator_role" />;
    }
    case "episode": {
      return <Message message="admin.audit.targets.episode" />;
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
    case "series": {
      return <Message message="admin.audit.targets.series" />;
    }
    default: {
      return null;
    }
  }
};

/** The name of a tenant setting, royalty, or account target type. */
const tenantTargetName = (targetType: string) => {
  switch (targetType) {
    case "fcm_config": {
      return <Message message="admin.audit.targets.fcm_config" />;
    }
    case "payment_config": {
      return <Message message="admin.audit.targets.payment_config" />;
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
    case "tenant_admin_invitation": {
      return <Message message="admin.audit.targets.tenant_admin_invitation" />;
    }
    case "tenant_community_limits": {
      return <Message message="admin.audit.targets.tenant_community_limits" />;
    }
    case "tenant_retention": {
      return <Message message="admin.audit.targets.tenant_retention" />;
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
  catalogTargetName(targetType) ?? tenantTargetName(targetType);

const outcomeToneMap = {
  failure: "destructive",
  success: "success",
  unknown: "muted",
} as const;

const outcomeMessageKeys = {
  failure: "admin.audit.outcome.failure",
  success: "admin.audit.outcome.success",
  unknown: "admin.audit.outcome.unknown",
} as const satisfies Record<string, AdminMessageKey>;

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

export const AuditLogDateCell = ({
  createdAt,
  locale,
  timeZone,
}: AuditLogDateCellProps) => (
  <TableCell className="text-sm text-muted-foreground">
    {formatDateTime(createdAt, { fallback: "-", locale, timeZone })}
  </TableCell>
);

export const AuditLogActorCell = async ({
  actorName,
  actorRole,
  actorUserPublicId,
  locale,
}: AuditLogActorCellProps) => {
  const t = await getMessagesFor(locale);

  return (
    <TableCell>
      <div className="font-medium">
        {actorName || t("admin.audit.actor_unnamed")}
      </div>
      <div className="text-xs text-muted-foreground">
        {actorUserPublicId || t("admin.audit.actor_id_unknown")}
        {actorRole ? ` / ${await getTenantRoleLabel(actorRole, locale)}` : ""}
      </div>
    </TableCell>
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
  const reasonLabel =
    action === "tenant_smtp_test_email_sent"
      ? (smtpTestFailureMessage(reason, locale) ?? reason)
      : reason;

  return (
    <TableCell>
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
          {targetId ? ` / ${targetId}` : ""}
          {reasonLabel ? ` / ${reasonLabel}` : ""}
        </div>
      )}
    </TableCell>
  );
};

export const AuditLogOutcomeCell = async ({
  locale,
  outcome,
}: AuditLogOutcomeCellProps) => {
  const t = await getMessagesFor(locale);

  return (
    <TableCell>
      <Badge tone={outcomeToneMap[outcome]}>
        {t(outcomeMessageKeys[outcome])}
      </Badge>
    </TableCell>
  );
};
