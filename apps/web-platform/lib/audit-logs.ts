import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

export interface PlatformAuditLogSummary {
  action: string;
  actorName: string;
  actorRole: string;
  actorUserPublicId: string;
  createdAt: string;
  outcome: string;
  reason: string;
  targetId: string;
  targetPublicId: string;
  targetName: string;
  targetType: string;
  tenantName: string;
  tenantPublicId: string;
}

export interface ListPlatformAuditLogsInput {
  action?: string;
  actorUserPublicId?: string;
  limit?: number;
  offset?: number;
  tenantPublicId?: string;
}

export type ListPlatformAuditLogsResult =
  | { ok: true; auditLogs: PlatformAuditLogSummary[] }
  | { ok: false; message: string };

export const listPlatformAuditLogs = async (
  input: ListPlatformAuditLogsInput
): Promise<ListPlatformAuditLogsResult> => {
  "use cache: private";

  const sid = await resolveSessionId();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(200, Math.trunc(input.limit)))
      : 100;
  const offset =
    typeof input.offset === "number" && Number.isFinite(input.offset)
      ? Math.max(0, Math.trunc(input.offset))
      : 0;

  try {
    const response = await apiClient.auditLogs.listAuditLogs(
      {
        action: input.action?.trim() ?? "",
        actorUserPublicId: input.actorUserPublicId?.trim() ?? "",
        limit,
        offset,
        tenantPublicId: input.tenantPublicId?.trim() ?? "",
      } as never,
      buildSessionHeaders(sid)
    );

    return {
      auditLogs: (response.auditLogs ?? []).map((log) => ({
        action: log.action,
        actorName: log.actorName,
        actorRole: log.actorRole,
        actorUserPublicId: log.actorUserPublicId,
        createdAt: log.createdAt,
        outcome: log.outcome,
        reason: log.reason,
        targetId: log.targetId,
        targetName: log.targetName,
        targetPublicId: log.targetPublicId ?? "",
        targetType: log.targetType,
        tenantName: log.tenantName ?? "",
        tenantPublicId: log.tenantPublicId ?? "",
      })),
      ok: true,
    };
  } catch (error) {
    console.error("[listPlatformAuditLogs] API error:", error);
    const message =
      error instanceof Error ? error.message : "不明なエラーが発生しました。";
    return { message, ok: false };
  }
};
