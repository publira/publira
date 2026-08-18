import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { isUnauthenticatedError } from "./auth-shared";

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
  tenantId: string;
}

export interface ListPlatformAuditLogsInput {
  action?: string;
  actorUserPublicId?: string;
  limit?: number;
  tenantId?: string;
  token?: string;
}

export type ListPlatformAuditLogsResult =
  | {
      auditLogs: PlatformAuditLogSummary[];
      nextToken: string;
      ok: true;
      previousToken: string;
    }
  | {
      auditLogs: PlatformAuditLogSummary[];
      ok: false;
      message: string;
      nextToken: string;
      previousToken: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export const listPlatformAuditLogs = async (
  input: ListPlatformAuditLogsInput
): Promise<ListPlatformAuditLogsResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    dropFailedCacheEntry();
    return {
      auditLogs: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    };
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(200, Math.trunc(input.limit)))
      : 100;

  try {
    const response = await apiClient.auditLogs.listAuditLogs(
      {
        action: input.action?.trim() ?? "",
        actorUserPublicId: input.actorUserPublicId?.trim() ?? "",
        limit,
        tenantId: input.tenantId?.trim() ?? "",
        token: input.token ?? "",
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
        tenantId: log.tenantPublicId ?? "",
        tenantName: log.tenantName ?? "",
      })),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    return {
      auditLogs: [],
      message: rpcErrorMessage(
        error,
        "監査ログの取得に失敗しました。時間をおいて再試行してください。"
      ),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
