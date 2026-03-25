import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformAuditLogs } from "./audit-logs";

const { mockBuildSessionHeaders, mockListAuditLogs, mockResolveSessionId } =
  vi.hoisted(() => ({
    mockBuildSessionHeaders: vi.fn(),
    mockListAuditLogs: vi.fn(),
    mockResolveSessionId: vi.fn(),
  }));

vi.mock("./api-client", () => ({
  apiClient: {
    auditLogs: {
      listAuditLogs: mockListAuditLogs,
    },
  },
  buildSessionHeaders: mockBuildSessionHeaders,
  resolveSessionId: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
  mockBuildSessionHeaders.mockImplementation((sessionId: string) => ({
    headers: { "X-Publira-Session-Id": sessionId },
  }));
});

describe("listPlatformAuditLogs", () => {
  it("正常系: 監査ログ一覧を返す", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "運営 太郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "テナントA",
          targetType: "tenant",
          tenantName: "テナントA",
          tenantPublicId: "tenant_001",
        },
      ],
    });

    await expect(listPlatformAuditLogs({})).resolves.toEqual({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "運営 太郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "テナントA",
          targetType: "tenant",
          tenantName: "テナントA",
          tenantPublicId: "tenant_001",
        },
      ],
      ok: true,
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "",
        actorUserPublicId: "",
        limit: 100,
        offset: 0,
        tenantPublicId: "",
      },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("tenant / actor / action フィルターを API に渡す", async () => {
    mockListAuditLogs.mockResolvedValueOnce({ auditLogs: [] });

    await expect(
      listPlatformAuditLogs({
        action: "tenant.status.updated",
        actorUserPublicId: "op_123",
        limit: 20,
        offset: 40,
        tenantPublicId: "tenant_999",
      })
    ).resolves.toEqual({ auditLogs: [], ok: true });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "tenant.status.updated",
        actorUserPublicId: "op_123",
        limit: 20,
        offset: 40,
        tenantPublicId: "tenant_999",
      },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("sessionId を解決できない場合は API を呼ばずエラーを返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformAuditLogs({})).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockListAuditLogs).not.toHaveBeenCalled();
  });

  it("API がエラーを返した場合はエラーメッセージを返す", async () => {
    mockListAuditLogs.mockRejectedValueOnce(new Error("network error"));

    await expect(listPlatformAuditLogs({})).resolves.toEqual({
      message: "network error",
      ok: false,
    });
  });
});
