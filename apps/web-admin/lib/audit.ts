import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { endOfDayIsoString, startOfDayIsoString } from "@publira/utils";

import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";
import { getTenantDisplayTimeZone } from "./tenant-timezone";

export interface AuditLogItem {
  action: string;
  actorName: string;
  actorRole: string;
  actorUserPublicId: string;
  clientIp: string;
  createdAt: string;
  outcome: "failure" | "success" | "unknown";
  reason: string;
  targetId: string;
  targetType: string;
}

export interface AuditLogFilters {
  action?: string;
  actorUserPublicId?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  token?: string;
}

export interface AuditActorCandidate {
  name: string;
  publicId: string;
  role: string;
}

export type ListAuditActorCandidatesResult =
  | {
      ok: true;
      actors: AuditActorCandidate[];
    }
  | {
      ok: false;
      actors: AuditActorCandidate[];
      message: string;
    };

export type ListAuditLogsResult =
  | {
      ok: true;
      auditLogs: AuditLogItem[];
      nextToken: string;
      previousToken: string;
    }
  | {
      ok: false;
      auditLogs: AuditLogItem[];
      message: string;
      nextToken: string;
      previousToken: string;
    };

const genericListErrorMessage =
  "監査ログの取得に失敗しました。時間をおいて再試行してください。";

const mapErrorToMessage = (error: unknown): string =>
  rpcErrorMessage(error, genericListErrorMessage, {
    // Every argument this call takes is a filter, so bad input is a bad filter.
    "invalid-argument":
      "フィルタ条件に誤りがあります。入力内容を確認してください。",
  });

/**
 * The `created_from` / `created_to` filters are date-only (`YYYY-MM-DD`) and the
 * API wants RFC3339 instants, so the calendar day has to be pinned to a zone.
 * That zone is the tenant's — the same one the list timestamps render in —
 * never UTC, which would shift the day relative to the day the operator picked.
 */
const normalizeDateStart = (
  value: string | undefined,
  timeZone: string
): string => startOfDayIsoString(value ?? "", timeZone);

// Inclusive calendar-day end for date-only filters (was identical to start).
const normalizeDateEnd = (
  value: string | undefined,
  timeZone: string
): string => endOfDayIsoString(value ?? "", timeZone);

const mapAuditLog = (item: {
  action: string;
  actorName: string;
  actorRole: string;
  actorUserPublicId: string;
  clientIp: string;
  createdAt: string;
  outcome: string;
  reason: string;
  targetId: string;
  targetType: string;
}): AuditLogItem => ({
  action: item.action,
  actorName: item.actorName,
  actorRole: item.actorRole,
  actorUserPublicId: item.actorUserPublicId,
  clientIp: item.clientIp,
  createdAt: item.createdAt,
  outcome:
    item.outcome === "success" || item.outcome === "failure"
      ? item.outcome
      : "unknown",
  reason: item.reason,
  targetId: item.targetId,
  targetType: item.targetType,
});

const mapAuditActorCandidate = (item: {
  name: string;
  publicId: string;
  role: string;
}): AuditActorCandidate => ({
  name: item.name,
  publicId: item.publicId,
  role: item.role,
});

export const listAuditActorCandidates = async (
  tenantId: string,
  options: {
    limit?: number;
    query?: string;
  } = {}
): Promise<ListAuditActorCandidatesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      actors: [],
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.users.listTenantUsers(
      {
        limit: options.limit ?? 100,
        query: options.query?.trim() ?? "",
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      actors: (response.users ?? []).map((item) =>
        mapAuditActorCandidate(item)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      actors: [],
      message: mapErrorToMessage(error),
      ok: false,
    };
  }
};

export const listAuditLogs = async (
  tenantId: string,
  filters: AuditLogFilters = {}
): Promise<ListAuditLogsResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      auditLogs: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
    };
  }

  try {
    const timeZone = await getTenantDisplayTimeZone(tenantId);
    const response = await apiClient.audit.listAuditLogs(
      {
        action: filters.action?.trim() ?? "",
        actorUserPublicId: filters.actorUserPublicId?.trim() ?? "",
        createdFrom: normalizeDateStart(filters.createdFrom, timeZone),
        createdTo: normalizeDateEnd(filters.createdTo, timeZone),
        limit: filters.limit ?? 20,
        tenant: { tenantId },
        token: filters.token?.trim() ?? "",
      },
      withSessionHeaders(sessionId)
    );

    return {
      auditLogs: (response.auditLogs ?? []).map((item) => mapAuditLog(item)),
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      auditLogs: [],
      message: mapErrorToMessage(error),
      nextToken: "",
      ok: false,
      previousToken: "",
    };
  }
};
