import {
  DEFAULT_TIME_ZONE,
  endOfDayIsoString,
  startOfDayIsoString,
} from "@publira/utils";

import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

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
  cursor?: string;
  limit?: number;
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
      nextCursor: string;
    }
  | {
      ok: false;
      auditLogs: AuditLogItem[];
      message: string;
      nextCursor: string;
    };

const genericListErrorMessage =
  "監査ログの取得に失敗しました。時間をおいて再試行してください。";

const mapErrorToMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return genericListErrorMessage;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes("unauthenticated") ||
    message.includes("permission_denied")
  ) {
    return "セッションが無効です。再ログインしてください。";
  }

  if (
    message.includes("invalid_argument") ||
    message.includes("rfc3339") ||
    message.includes("cursor")
  ) {
    return "フィルタ条件に誤りがあります。入力内容を確認してください。";
  }

  return genericListErrorMessage;
};

/**
 * The `created_from` / `created_to` filters are date-only (`YYYY-MM-DD`) and the
 * API wants RFC3339 instants, so the calendar day has to be pinned to a zone.
 * Tenant time zones are not wired up yet (#566 / #567), so the admin UI's own
 * display zone is used — never UTC, which would shift the day by nine hours
 * relative to the day the operator picked.
 */
const auditFilterTimeZone = DEFAULT_TIME_ZONE;

const normalizeDateStart = (value?: string): string =>
  startOfDayIsoString(value ?? "", auditFilterTimeZone);

// Inclusive calendar-day end for date-only filters (was identical to start).
const normalizeDateEnd = (value?: string): string =>
  endOfDayIsoString(value ?? "", auditFilterTimeZone);

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
      nextCursor: "",
      ok: false,
    };
  }

  try {
    const response = await apiClient.audit.listAuditLogs(
      {
        action: filters.action?.trim() ?? "",
        actorUserPublicId: filters.actorUserPublicId?.trim() ?? "",
        createdFrom: normalizeDateStart(filters.createdFrom),
        createdTo: normalizeDateEnd(filters.createdTo),
        cursor: filters.cursor?.trim() ?? "",
        limit: filters.limit ?? 20,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      auditLogs: (response.auditLogs ?? []).map((item) => mapAuditLog(item)),
      nextCursor: response.nextCursor ?? "",
      ok: true,
    };
  } catch (error) {
    return {
      auditLogs: [],
      message: mapErrorToMessage(error),
      nextCursor: "",
      ok: false,
    };
  }
};
