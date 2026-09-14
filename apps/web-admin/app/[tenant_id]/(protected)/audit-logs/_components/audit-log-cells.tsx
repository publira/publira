import { smtpTestFailureMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { TableCell } from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";

import type { AdminMessageKey } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantRoleLabel } from "#lib/role-labels";

/**
 * The action filter's options, in the order the select lists them. The label
 * is a catalog key rather than a string: this list also feeds
 * `toAllowedActionValues` at module scope, where no locale is resolved yet.
 */
export const auditActionOptions = [
  { messageKey: "admin.audit.actions.all", value: "" },
  { messageKey: "admin.audit.actions.series_created", value: "series_created" },
  { messageKey: "admin.audit.actions.series_updated", value: "series_updated" },
  {
    messageKey: "admin.audit.actions.episode_created",
    value: "episode_created",
  },
  {
    messageKey: "admin.audit.actions.episode_publish_schedule_updated",
    value: "episode_publish_schedule_updated",
  },
  {
    messageKey: "admin.audit.actions.creator_created",
    value: "creator_created",
  },
  {
    messageKey: "admin.audit.actions.creator_updated",
    value: "creator_updated",
  },
  { messageKey: "admin.audit.actions.label_created", value: "label_created" },
  { messageKey: "admin.audit.actions.label_updated", value: "label_updated" },
] as const satisfies readonly { messageKey: AdminMessageKey; value: string }[];

const actionMessageKeys: Record<string, AdminMessageKey> = Object.fromEntries(
  auditActionOptions
    .filter((option) => option.value)
    .map((option) => [option.value, option.messageKey])
);

const actionLabel = async (action: string, locale: Locale): Promise<string> => {
  const t = await getMessagesFor(locale);
  const key = actionMessageKeys[action];

  return key ? t(key) : t("admin.audit.actions.other");
};

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
  const [t, label] = await Promise.all([
    getMessagesFor(locale),
    actionLabel(action, locale),
  ]);
  const reasonLabel =
    action === "tenant_smtp_test_email_sent"
      ? (smtpTestFailureMessage(reason, locale) ?? reason)
      : reason;

  return (
    <TableCell>
      <div className="font-medium">{label}</div>
      {(targetType || targetId || reasonLabel) && (
        <div className="text-xs text-muted-foreground">
          {targetType || t("admin.audit.target_type_none")}
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
