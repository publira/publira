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

  it("共通 token を RPC に渡して前後の token を返す", async () => {
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
    const result = await listAuditLogs("TENANT001", {
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

  it("セッションが無い場合は空の token を返す", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listAuditLogs } = await import("./audit");
    const result = await listAuditLogs("TENANT001", { token: "token" });

    expect(mockListAuditLogs).not.toHaveBeenCalled();
    expect(result).toEqual({
      auditLogs: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });

  it("日付フィルタの日境界はテナントタイムゾーンで解釈する", async () => {
    mockGetTenantDisplayTimeZone.mockResolvedValue("America/Los_Angeles");
    mockListAuditLogs.mockResolvedValue({
      auditLogs: [],
      nextToken: "",
      previousToken: "",
    });

    const { listAuditLogs } = await import("./audit");
    await listAuditLogs("TENANT001", {
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
