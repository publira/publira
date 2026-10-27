import { Code, ConnectError } from "@publira/api-client/errors";
import { endOfDayIsoString, startOfDayIsoString } from "@publira/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExportAuditLogs,
  mockGetAccessToken,
  mockGetTenantDisplayTimeZone,
  mockListAuditLogs,
} = vi.hoisted(() => ({
  mockExportAuditLogs: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantDisplayTimeZone: vi.fn(),
  mockListAuditLogs: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./tenant-timezone", () => ({
  getTenantDisplayTimeZone: mockGetTenantDisplayTimeZone,
}));

vi.mock("./api", () => ({
  apiClient: {
    audit: {
      exportAuditLogs: mockExportAuditLogs,
      listAuditLogs: mockListAuditLogs,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("audit lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockGetTenantDisplayTimeZone.mockResolvedValue("UTC");
  });

  it("passes the shared token to the RPC and returns the tokens on both sides", async () => {
    mockListAuditLogs.mockResolvedValue({
      auditLogs: [
        {
          action: "series_created",
          actorName: "User One",
          actorRole: "editor",
          actorUserPublicId: "USER001",
          clientIp: "127.0.0.1",
          createdAt: "2026-08-10T12:00:00Z",
          outcome: "success",
          reason: "",
          targetId: "SERIES001",
          targetType: "series",
        },
      ],
      nextToken: "next-token",
      previousToken: "previous-token",
    });

    const { listAuditLogs } = await import("./audit");
    const result = await listAuditLogs("TENANT001", "en", {
      action: " series_created ",
      actorUserPublicId: " USER001 ",
      limit: 10,
      token: " current-token ",
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "series_created",
        actorUserPublicId: "USER001",
        createdFrom: "",
        createdTo: "",
        limit: 10,
        tenant: { tenantId: "TENANT001" },
        token: "current-token",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      auditLogs: [
        {
          action: "series_created",
          actorName: "User One",
          actorRole: "editor",
          actorUserPublicId: "USER001",
          clientIp: "127.0.0.1",
          createdAt: "2026-08-10T12:00:00Z",
          outcome: "success",
          reason: "",
          targetId: "SERIES001",
          targetType: "series",
        },
      ],
      nextToken: "next-token",
      ok: true,
      previousToken: "previous-token",
    });
  });

  it("returns empty tokens when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listAuditLogs } = await import("./audit");
    const result = await listAuditLogs("TENANT001", "en", { token: "token" });

    expect(mockListAuditLogs).not.toHaveBeenCalled();
    expect(result).toEqual({
      auditLogs: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("reads the day boundary of the date filter in the tenant time zone", async () => {
    mockGetTenantDisplayTimeZone.mockResolvedValue("America/Los_Angeles");
    mockListAuditLogs.mockResolvedValue({
      auditLogs: [],
      nextToken: "",
      previousToken: "",
    });

    const { listAuditLogs } = await import("./audit");
    await listAuditLogs("TENANT001", "en", {
      createdFrom: "2026-08-10",
      createdTo: "2026-08-10",
    });

    expect(mockGetTenantDisplayTimeZone).toHaveBeenCalledWith("TENANT001");
    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "",
        actorUserPublicId: "",
        createdFrom: startOfDayIsoString("2026-08-10", "America/Los_Angeles"),
        createdTo: endOfDayIsoString("2026-08-10", "America/Los_Angeles"),
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});

const january = {
  action: "",
  actor: "",
  end: "2026-01-31",
  start: "2026-01-01",
} as const;

describe("auditLogCsvPath", () => {
  it("spells out the period and only the filters that narrow the file", async () => {
    const { auditLogCsvPath, auditLogsHref } = await import("./audit");

    expect(auditLogCsvPath(january)).toBe(
      "/api/v1/audit-logs/csv?from=2026-01-01&to=2026-01-31"
    );
    expect(
      auditLogsHref({ ...january, action: "label_created", actor: "ADMIN001" })
    ).toBe(
      "/audit-logs?action=label_created&actor=ADMIN001&from=2026-01-01&to=2026-01-31"
    );
  });
});

describe("exportAuditLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("asks for the period and the filters, and answers the file byte for byte", async () => {
    const csv = new TextEncoder().encode("\uFEFFtime,actor_public_id\r\n");
    mockExportAuditLogs.mockResolvedValueOnce({ csv });

    const { exportAuditLogs } = await import("./audit");

    await expect(
      exportAuditLogs("TENANT001", {
        ...january,
        action: "label_created",
        actor: "ADMIN001",
      })
    ).resolves.toEqual({ csv, ok: true });
    expect(mockExportAuditLogs).toHaveBeenCalledWith(
      {
        action: "label_created",
        actorUserPublicId: "ADMIN001",
        endDate: "2026-01-31",
        startDate: "2026-01-01",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("answers signed out without a session, and asks the API nothing", async () => {
    mockGetAccessToken.mockResolvedValueOnce(undefined);

    const { exportAuditLogs } = await import("./audit");

    await expect(exportAuditLogs("TENANT001", january)).resolves.toEqual({
      ok: false,
      reason: "signedOut",
    });
    expect(mockExportAuditLogs).not.toHaveBeenCalled();
  });

  it("answers signed out for a session the API rejects", async () => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { exportAuditLogs } = await import("./audit");

    await expect(exportAuditLogs("TENANT001", january)).resolves.toEqual({
      ok: false,
      reason: "signedOut",
    });
  });

  it.each([
    ["a role below tenant admin", Code.PermissionDenied],
    ["a period the API refuses", Code.InvalidArgument],
  ])("answers missing for %s", async (_label, code) => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("refused", code)
    );

    const { exportAuditLogs } = await import("./audit");

    await expect(exportAuditLogs("TENANT001", january)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("lets any other failure reach the error boundary", async () => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("database down", Code.Unavailable)
    );

    const { exportAuditLogs } = await import("./audit");

    await expect(exportAuditLogs("TENANT001", january)).rejects.toThrow(
      "database down"
    );
  });
});
