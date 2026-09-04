import { endOfDayIsoString, startOfDayIsoString } from "@publira/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAccessToken, mockGetTenantDisplayTimeZone, mockListAuditLogs } =
  vi.hoisted(() => ({
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
    mockGetTenantDisplayTimeZone.mockResolvedValue("Asia/Tokyo");
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
