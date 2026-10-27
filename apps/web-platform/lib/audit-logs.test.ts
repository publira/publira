import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAuditLogCsvPath,
  buildAuditLogsPath,
  exportPlatformAuditLogs,
  listPlatformAuditLogs,
  platformAuditLogsCacheTag,
} from "./audit-logs";

const {
  mockBuildSessionHeaders,
  mockCacheLife,
  mockCacheTag,
  mockExportAuditLogs,
  mockListAuditLogs,
  mockResolveSessionId,
} = vi.hoisted(() => ({
  mockBuildSessionHeaders: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockExportAuditLogs: vi.fn(),
  mockListAuditLogs: vi.fn(),
  mockResolveSessionId: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auditLogs: {
      exportAuditLogs: mockExportAuditLogs,
      listAuditLogs: mockListAuditLogs,
    },
  },
  buildSessionHeaders: mockBuildSessionHeaders,
  resolveAccessToken: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
  mockBuildSessionHeaders.mockImplementation((sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }));
});

describe("listPlatformAuditLogs", () => {
  it("returns audit logs", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantName: "Tenant A",
          tenantPublicId: "tenant_001",
        },
      ],
    });

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantId: "tenant_001",
          tenantName: "Tenant A",
        },
      ],
      nextToken: "",
      ok: true,
      previousToken: "",
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "",
        actorUserPublicId: "",
        createdFrom: "",
        createdTo: "",
        limit: 100,
        tenantId: "",
        token: "",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("returns previousToken and nextToken from the response unchanged", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantName: "Tenant A",
          tenantPublicId: "tenant_001",
        },
      ],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    await expect(
      listPlatformAuditLogs({ locale: "en", token: "current-page" })
    ).resolves.toEqual({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantId: "tenant_001",
          tenantName: "Tenant A",
        },
      ],
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "",
        actorUserPublicId: "",
        createdFrom: "",
        createdTo: "",
        limit: 100,
        tenantId: "",
        token: "current-page",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("passes tenant, actor, action, and period filters to the API", async () => {
    mockListAuditLogs.mockResolvedValueOnce({ auditLogs: [] });

    await expect(
      listPlatformAuditLogs({
        action: "tenant.status.updated",
        actorUserPublicId: "op_123",
        createdFrom: "2026-01-09T15:00:00Z",
        createdTo: "2026-01-11T15:00:00Z",
        limit: 20,
        locale: "en",
        tenantId: "tenant_999",
        token: "page-2",
      })
    ).resolves.toEqual({
      auditLogs: [],
      nextToken: "",
      ok: true,
      previousToken: "",
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "tenant.status.updated",
        actorUserPublicId: "op_123",
        createdFrom: "2026-01-09T15:00:00Z",
        createdTo: "2026-01-11T15:00:00Z",
        limit: 20,
        tenantId: "tenant_999",
        token: "page-2",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("returns audit logs when tenant information is empty", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "operator.signed_in",
          actorName: "Jordan Blake",
          actorRole: "platform_owner",
          actorUserPublicId: "op_002",
          createdAt: "2026-03-25T02:34:56Z",
          outcome: "success",
          reason: "",
          targetId: "op_002",
          targetName: "Jordan Blake",
          targetPublicId: "",
          targetType: "operator",
          tenantId: undefined,
          tenantName: undefined,
        },
      ],
    });

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [
        {
          action: "operator.signed_in",
          actorName: "Jordan Blake",
          actorRole: "platform_owner",
          actorUserPublicId: "op_002",
          createdAt: "2026-03-25T02:34:56Z",
          outcome: "success",
          reason: "",
          targetId: "op_002",
          targetName: "Jordan Blake",
          targetPublicId: "",
          targetType: "operator",
          tenantId: "",
          tenantName: "",
        },
      ],
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("returns an error without calling the API when sessionId cannot be resolved", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });

    expect(mockListAuditLogs).not.toHaveBeenCalled();
  });

  it("returns an English session error for locale=en", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("returns a shared message for unavailable errors", async () => {
    mockListAuditLogs.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [],
      message: "Could not connect to the server. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockListAuditLogs.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformAuditLogs({ locale: "en" })).rejects.toThrow(
      Error
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("audit log cache tag", () => {
  it("files the audit log under the audit-logs tag", async () => {
    mockListAuditLogs.mockResolvedValueOnce({ auditLogs: [] });

    await listPlatformAuditLogs({ locale: "en" });

    expect(platformAuditLogsCacheTag).toBe("platform:audit-logs");
    expect(mockCacheTag).toHaveBeenCalledWith(platformAuditLogsCacheTag);
  });
});

const unfiltered = {
  action: "",
  actorUserPublicId: "",
  createdFrom: "",
  createdTo: "",
  tenantPublicId: "",
};

describe("buildAuditLogsPath", () => {
  it("keeps the filters and the page token in the URL", () => {
    expect(
      buildAuditLogsPath(
        {
          action: "operator_created",
          actorUserPublicId: "user_1",
          createdFrom: "2026-01-01",
          createdTo: "2026-01-31",
          tenantPublicId: "tenant_a",
        },
        "next-page"
      )
    ).toBe(
      "/audit-logs?tenant_id=tenant_a&actor_user_public_id=user_1&action=operator_created&created_from=2026-01-01&created_to=2026-01-31&token=next-page"
    );
  });

  it("returns the list root when there are no conditions", () => {
    expect(buildAuditLogsPath(unfiltered)).toBe("/audit-logs");
  });
});

describe("buildAuditLogCsvPath", () => {
  it("names only the filters that narrow the file", () => {
    expect(
      buildAuditLogCsvPath({
        ...unfiltered,
        createdFrom: "2026-01-01",
        createdTo: "2026-01-31",
      })
    ).toBe(
      "/api/v1/audit-logs/csv?created_from=2026-01-01&created_to=2026-01-31"
    );
  });
});

describe("exportPlatformAuditLogs", () => {
  const january = {
    action: "",
    actorUserPublicId: "",
    end: "2026-01-31",
    start: "2026-01-01",
    tenantId: "",
  };

  it("asks for the period and the filters, and answers the file byte for byte", async () => {
    const csv = new TextEncoder().encode("\uFEFFtime,actor_public_id\r\n");
    mockExportAuditLogs.mockResolvedValueOnce({ csv });

    await expect(
      exportPlatformAuditLogs({
        ...january,
        action: "tenant_created",
        actorUserPublicId: "op_001",
        tenantId: "tenant_001",
      })
    ).resolves.toEqual({ csv, ok: true });
    expect(mockExportAuditLogs).toHaveBeenCalledWith(
      {
        action: "tenant_created",
        actorUserPublicId: "op_001",
        endDate: "2026-01-31",
        startDate: "2026-01-01",
        tenantId: "tenant_001",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("answers signed out without a session, and asks the API nothing", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(exportPlatformAuditLogs(january)).resolves.toEqual({
      ok: false,
      reason: "signedOut",
    });
    expect(mockExportAuditLogs).not.toHaveBeenCalled();
  });

  it("answers signed out for a session the API rejects", async () => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(exportPlatformAuditLogs(january)).resolves.toEqual({
      ok: false,
      reason: "signedOut",
    });
  });

  it("answers missing for a period the API refuses", async () => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("refused", Code.InvalidArgument)
    );

    await expect(exportPlatformAuditLogs(january)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("lets any other failure reach the error boundary", async () => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("database down", Code.Unavailable)
    );

    await expect(exportPlatformAuditLogs(january)).rejects.toThrow(
      "database down"
    );
  });
});
