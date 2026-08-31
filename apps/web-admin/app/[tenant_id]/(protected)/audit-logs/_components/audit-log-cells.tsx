import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { Badge } from "@publira/ui-components/badge";
import { TableCell } from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";

import type { AdminMessageKey } from "#lib/locale";
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

const actionLabel = (action: string, messages: SharedMessages): string => {
  const key = actionMessageKeys[action];

  return key
    ? getMessage(messages, key)
    : getMessage(messages, "admin.audit.actions.other");
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

export const AuditLogActorCell = ({
  actorName,
  actorRole,
  actorUserPublicId,
  locale,
}: AuditLogActorCellProps) => {
  const messages = sharedCatalog(locale);

  return (
    <TableCell>
      <div className="font-medium">
        {actorName || getMessage(messages, "admin.audit.actor_unnamed")}
      </div>
      <div className="text-xs text-muted-foreground">
        {actorUserPublicId ||
          getMessage(messages, "admin.audit.actor_id_unknown")}
        {actorRole ? ` / ${getTenantRoleLabel(actorRole, messages)}` : ""}
      </div>
    </TableCell>
  );
};

export const AuditLogActionCell = ({
  action,
  locale,
  reason,
  targetId,
  targetType,
}: AuditLogActionCellProps) => {
  const messages = sharedCatalog(locale);

  return (
    <TableCell>
      <div className="font-medium">{actionLabel(action, messages)}</div>
      {(targetType || targetId || reason) && (
        <div className="text-xs text-muted-foreground">
          {targetType || getMessage(messages, "admin.audit.target_type_none")}
          {targetId ? ` / ${targetId}` : ""}
          {reason ? ` / ${reason}` : ""}
        </div>
      )}
    </TableCell>
  );
};

export const AuditLogOutcomeCell = ({
  locale,
  outcome,
}: AuditLogOutcomeCellProps) => (
  <TableCell>
    <Badge tone={outcomeToneMap[outcome]}>
      {getMessage(sharedCatalog(locale), outcomeMessageKeys[outcome])}
    </Badge>
  </TableCell>
);
