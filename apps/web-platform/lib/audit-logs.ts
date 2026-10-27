import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { isUnauthenticatedError } from "./auth-shared";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";

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
  /** RFC 3339 instants, `createdTo` exclusive, as the API takes them. */
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  locale: Locale;
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

/** The tag the audit log read is filed under, cleared by every write the API records. */
export const platformAuditLogsCacheTag = "platform:audit-logs";

const listPlatformAuditLogsForSession = async (
  input: ListPlatformAuditLogsInput,
  sid: string
): Promise<CachedRead<ListPlatformAuditLogsResult>> => {
  "use cache: private";
  cacheTag(platformAuditLogsCacheTag);

  if (!sid) {
    dropFailedCacheEntry();
    const t = await getMessagesFor(input.locale);
    return {
      auditLogs: [],
      message: t("errors.rpc.unauthenticated"),
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
        createdFrom: input.createdFrom ?? "",
        createdTo: input.createdTo ?? "",
        limit,
        tenantId: input.tenantId?.trim() ?? "",
        token: input.token ?? "",
      },
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
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    const t = await getMessagesFor(input.locale);
    return {
      auditLogs: [],
      message: rpcErrorMessage(error, t("platform.audit.list_failed"), {
        locale: input.locale,
      }),
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const listPlatformAuditLogs = async (
  input: ListPlatformAuditLogsInput
): Promise<ListPlatformAuditLogsResult> =>
  settleCachedRead(
    await listPlatformAuditLogsForSession(input, await resolveAccessToken())
  );

/**
 * The filters the audit log's URLs carry, by the names its query string uses.
 * The days are calendar days of the platform's default time zone, inclusive at
 * both ends, and an empty value leaves its filter off.
 */
export interface AuditLogsPathInput {
  action: string;
  actorUserPublicId: string;
  createdFrom: string;
  createdTo: string;
  /** The tenant by public ID, as a tenant's page links to the log. */
  tenantPublicId: string;
}

const auditLogsQuery = (
  {
    action,
    actorUserPublicId,
    createdFrom,
    createdTo,
    tenantPublicId,
  }: AuditLogsPathInput,
  token = ""
): string => {
  const search = new URLSearchParams();
  if (tenantPublicId) {
    search.set("tenant_id", tenantPublicId);
  }
  if (actorUserPublicId) {
    search.set("actor_user_public_id", actorUserPublicId);
  }
  if (action) {
    search.set("action", action);
  }
  if (createdFrom) {
    search.set("created_from", createdFrom);
  }
  if (createdTo) {
    search.set("created_to", createdTo);
  }
  if (token) {
    search.set("token", token);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
};

/** The audit log narrowed by `filters`, on the page `token` names. */
export const buildAuditLogsPath = (
  filters: AuditLogsPathInput,
  token = ""
): string => `/audit-logs${auditLogsQuery(filters, token)}`;

/**
 * Where a download is served, under the same query as the list it is taken
 * from. The caller spells out both days, so the file covers the period the
 * screen named whenever the link is opened.
 */
export const buildAuditLogCsvPath = (filters: AuditLogsPathInput): string =>
  `/api/v1/audit-logs/csv${auditLogsQuery(filters)}`;

/** What one download covers: inclusive days and the list's own filters. */
export interface ExportPlatformAuditLogsInput {
  action: string;
  actorUserPublicId: string;
  end: string;
  start: string;
  /** The tenant by primary key, as the API filters on it. */
  tenantId: string;
}

export type ExportPlatformAuditLogsResult =
  | { ok: true; csv: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "missing" | "signedOut" };

/**
 * Every entry of a period as the CSV the API encodes, byte for byte. A period
 * the API refuses is answered as a file that is not there.
 */
export const exportPlatformAuditLogs = async (
  input: ExportPlatformAuditLogsInput
): Promise<ExportPlatformAuditLogsResult> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return { ok: false, reason: "signedOut" };
  }

  try {
    const response = await apiClient.auditLogs.exportAuditLogs(
      {
        action: input.action,
        actorUserPublicId: input.actorUserPublicId,
        endDate: input.end,
        startDate: input.start,
        tenantId: input.tenantId,
      },
      buildSessionHeaders(sid)
    );
    return { csv: new Uint8Array(response.csv), ok: true };
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return { ok: false, reason: "signedOut" };
    }
    if (
      isMissingResourceRpcError(error) ||
      isRpcError(error, Code.InvalidArgument)
    ) {
      return { ok: false, reason: "missing" };
    }
    throw error;
  }
};
