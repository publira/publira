import { Badge } from "@publira/ui-components/badge";
import { TableCell } from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";

export const auditActionOptions = [
  { label: "すべて", value: "" },
  { label: "シリーズ作成", value: "series_created" },
  { label: "シリーズ更新", value: "series_updated" },
  { label: "エピソード作成", value: "episode_created" },
  { label: "公開設定更新", value: "episode_publish_schedule_updated" },
  { label: "著者作成", value: "creator_created" },
  { label: "著者更新", value: "creator_updated" },
  { label: "レーベル作成", value: "label_created" },
  { label: "レーベル更新", value: "label_updated" },
] as const;

const actionLabelMap: Record<string, string> = Object.fromEntries(
  auditActionOptions
    .filter((option) => option.value)
    .map((option) => [option.value, option.label])
);

const roleLabelMap: Record<string, string> = {
  member: "メンバー",
  tenant_admin: "テナント管理者",
};

const outcomeToneMap = {
  failure: "destructive",
  success: "success",
  unknown: "muted",
} as const;

const outcomeLabelMap = {
  failure: "失敗",
  success: "成功",
  unknown: "不明",
} as const;

type AuditOutcome = "failure" | "success" | "unknown";

interface AuditLogDateCellProps {
  createdAt: string;
  timeZone: string;
}

interface AuditLogActorCellProps {
  actorName: string;
  actorRole: string;
  actorUserPublicId: string;
}

interface AuditLogActionCellProps {
  action: string;
  reason: string;
  targetId: string;
  targetType: string;
}

interface AuditLogOutcomeCellProps {
  outcome: AuditOutcome;
}

export const AuditLogDateCell = ({
  createdAt,
  timeZone,
}: AuditLogDateCellProps) => (
  <TableCell className="text-sm text-muted-foreground">
    {formatDateTime(createdAt, { fallback: "-", timeZone })}
  </TableCell>
);

export const AuditLogActorCell = ({
  actorName,
  actorRole,
  actorUserPublicId,
}: AuditLogActorCellProps) => (
  <TableCell>
    <div className="font-medium">{actorName || "名前未設定"}</div>
    <div className="text-xs text-muted-foreground">
      {actorUserPublicId || "公開 ID 不明"}
      {actorRole ? ` / ${roleLabelMap[actorRole] ?? "不明な権限"}` : ""}
    </div>
  </TableCell>
);

export const AuditLogActionCell = ({
  action,
  reason,
  targetId,
  targetType,
}: AuditLogActionCellProps) => (
  <TableCell>
    <div className="font-medium">
      {actionLabelMap[action] ?? "その他の操作"}
    </div>
    {(targetType || targetId || reason) && (
      <div className="text-xs text-muted-foreground">
        {targetType || "対象種別なし"}
        {targetId ? ` / ${targetId}` : ""}
        {reason ? ` / ${reason}` : ""}
      </div>
    )}
  </TableCell>
);

export const AuditLogOutcomeCell = ({ outcome }: AuditLogOutcomeCellProps) => (
  <TableCell>
    <Badge tone={outcomeToneMap[outcome]}>{outcomeLabelMap[outcome]}</Badge>
  </TableCell>
);
