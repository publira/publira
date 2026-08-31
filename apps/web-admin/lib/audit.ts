import type {
  AdminAuditLog,
  AdminTenantUser,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { endOfDayIsoString, startOfDayIsoString } from "@publira/utils";

import { isUnauthenticatedError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { FALLBACK_LOCALE } from "./fallback-locale";
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
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
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
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

const genericListErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.audit.list_failed");

const mapErrorToMessage = (error: unknown, locale: Locale): string => {
  const messages = sharedCatalog(locale);

  return rpcErrorMessage(error, genericListErrorMessage(messages), {
    locale,
    // Every argument this call takes is a filter, so bad input is a bad filter.
    overrides: {
      "invalid-argument": getMessage(messages, "admin.audit.filter_invalid"),
    },
  });
};

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

/** The generated `AdminAuditLog` fields {@link mapAuditLog} reads (see `series.ts`). */
type RawAuditLog = Pick<
  AdminAuditLog,
  | "action"
  | "actorName"
  | "actorRole"
  | "actorUserPublicId"
  | "clientIp"
  | "createdAt"
  | "outcome"
  | "reason"
  | "targetId"
  | "targetType"
>;

const mapAuditLog = (item: RawAuditLog): AuditLogItem => ({
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

/** The generated `AdminTenantUser` fields {@link mapAuditActorCandidate} reads (see `series.ts`). */
type RawAuditActorCandidate = Pick<
  AdminTenantUser,
  "name" | "publicId" | "role"
>;

const mapAuditActorCandidate = (
  item: RawAuditActorCandidate
): AuditActorCandidate => ({
  name: item.name,
  publicId: item.publicId,
  role: item.role,
});

export const listAuditActorCandidates = async (
  tenantId: string,
  options: {
    limit?: number;
    query?: string;
  } = {},
  locale: Locale = FALLBACK_LOCALE
): Promise<ListAuditActorCandidatesResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      actors: [],
      message: getMessage(sharedCatalog(locale), "errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
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
      message: mapErrorToMessage(error, locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const listAuditLogs = async (
  tenantId: string,
  filters: AuditLogFilters = {},
  locale: Locale = FALLBACK_LOCALE
): Promise<ListAuditLogsResult> => {
  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      auditLogs: [],
      message: getMessage(sharedCatalog(locale), "errors.rpc.unauthenticated"),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
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
      message: mapErrorToMessage(error, locale),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
